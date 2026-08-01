import { randomUUID } from 'node:crypto';

import {
  BrowserWindow,
  clipboard,
  desktopCapturer,
  nativeImage,
  screen,
  type Display,
  type IpcMainEvent,
  type NativeImage,
  type Rectangle,
} from 'electron';
import sharp from 'sharp';

import type { CaptureFormat } from '../../src/core/creative/capture';
import { IPC_INBOUND } from '../ipc/contract';
import type { IpcRegistrar } from '../ipc/registry';
import { resolveTrustedPreloadPath, SECURE_RENDERER_PREFERENCES } from '../window-security';

import type { CaptureService } from './capture-service';
import { CaptureConsentStore, type CaptureUploadConsent, type GoogleImageSearchProvider } from './capture-consent-store';
import { GoogleImageSearchAdapter, trustedSprint02GoogleAdapter, type GoogleImageSearchResult } from './google-image-search-adapter';
import { RetainedCaptureStore, type RetainedCaptureSummary } from './retained-capture-store';

export type DesktopCaptureMode = 'source' | 'region';
export type RegionAspectPreset = 'free' | '1:1' | '4:3' | '16:9' | '9:16' | '21:9';

export interface DesktopCaptureRequest {
  sourceId: string;
  mode: DesktopCaptureMode;
  format: CaptureFormat;
  save: boolean;
  copyToClipboard: boolean;
  delaySeconds?: 0 | 3 | 5 | 10;
  aspectPreset?: RegionAspectPreset;
  jpegQuality?: number;
}

export interface DesktopCaptureResult {
  retained: RetainedCaptureSummary;
  sourceId: string;
  sourceName: string;
  displayId: string | null;
  mode: DesktopCaptureMode;
  format: CaptureFormat;
  dataUrl: string;
  outputPath: string | null;
  selection: Rectangle;
  pixelSelection: Rectangle;
  imageSize: { width: number; height: number };
  scale: { x: number; y: number };
  openActionMenu: boolean;
}

export type DesktopCaptureOperation = DesktopCaptureRequest | {
  operation: 'list-retained';
} | {
  operation: 'retained-action';
  retainedId: string;
  action: 'get' | 'copy' | 'pin' | 'unpin' | 'delete';
} | {
  operation: 'create-upload-consent';
  retainedId: string;
  provider: GoogleImageSearchProvider;
} | {
  operation: 'resolve-upload-consent';
  consentId: string;
  accepted: boolean;
};

export type DesktopCaptureOperationResult = DesktopCaptureResult | RetainedCaptureSummary[] | RetainedCaptureSummary | CaptureUploadConsent | GoogleImageSearchResult | { deleted: boolean } | { declined: true } | { summary: RetainedCaptureSummary; dataUrl: string } | null;

interface SelectorPayload extends Rectangle {
  token: string;
  activation?: 'capture' | 'action-menu';
}

interface SelectorResult {
  rectangle: Rectangle;
  activation: 'capture' | 'action-menu';
}

const COMPLETE_CHANNEL = IPC_INBOUND.CAPTURE_SELECTOR_COMPLETE;
const CANCEL_CHANNEL = IPC_INBOUND.CAPTURE_SELECTOR_CANCEL;
const MAX_CAPTURE_EDGE = 16_384;
const MAX_CAPTURE_AREA = 134_217_728;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function validateRequest(request: DesktopCaptureRequest): DesktopCaptureRequest {
  if (!request || typeof request !== 'object') throw new TypeError('Desktop capture request is required.');
  if (typeof request.sourceId !== 'string' || request.sourceId.length < 3 || request.sourceId.length > 512) {
    throw new TypeError('Desktop capture source ID is invalid.');
  }
  if (request.mode !== 'source' && request.mode !== 'region') throw new TypeError('Desktop capture mode is invalid.');
  if (!['png', 'jpeg', 'webp'].includes(request.format)) throw new TypeError('Desktop capture format is invalid.');
  if (!request.save && !request.copyToClipboard) throw new TypeError('Desktop capture must be saved or copied.');
  if (![0, 3, 5, 10].includes(request.delaySeconds ?? 0)) throw new RangeError('Capture delay must be 0, 3, 5, or 10 seconds.');
  if (!['free', '1:1', '4:3', '16:9', '9:16', '21:9'].includes(request.aspectPreset ?? 'free')) {
    throw new TypeError('Region aspect preset is invalid.');
  }
  return {
    ...request,
    delaySeconds: request.delaySeconds ?? 0,
    aspectPreset: request.aspectPreset ?? 'free',
    jpegQuality: clamp(Math.round(request.jpegQuality ?? 92), 40, 100),
  };
}

function displayForSource(displayId: string): Display {
  return screen.getAllDisplays().find((display) => String(display.id) === displayId)
    ?? screen.getPrimaryDisplay();
}

function maximumPhysicalCaptureSize(): { width: number; height: number } {
  const displays = screen.getAllDisplays();
  const width = Math.max(...displays.map((display) => Math.ceil(display.bounds.width * display.scaleFactor)), 1920);
  const height = Math.max(...displays.map((display) => Math.ceil(display.bounds.height * display.scaleFactor)), 1080);
  return {
    width: clamp(width, 1, MAX_CAPTURE_EDGE),
    height: clamp(height, 1, MAX_CAPTURE_EDGE),
  };
}

function sanitizedRectangle(value: Partial<Rectangle>, bounds: Rectangle): Rectangle {
  const x = clamp(Math.round(Number(value.x) || 0), 0, Math.max(0, bounds.width - 1));
  const y = clamp(Math.round(Number(value.y) || 0), 0, Math.max(0, bounds.height - 1));
  const width = clamp(Math.round(Number(value.width) || 0), 1, bounds.width - x);
  const height = clamp(Math.round(Number(value.height) || 0), 1, bounds.height - y);
  if (width * height > MAX_CAPTURE_AREA) throw new RangeError('Selected region is too large.');
  return { x, y, width, height };
}

async function encodeImage(image: NativeImage, format: CaptureFormat, jpegQuality: number): Promise<{ bytes: Buffer; dataUrl: string }> {
  const png = image.toPNG();
  if (png.length === 0) throw new Error('The selected desktop region could not be encoded.');

  let bytes: Buffer;
  let mime: string;
  if (format === 'png') {
    bytes = png;
    mime = 'image/png';
  } else if (format === 'jpeg') {
    bytes = await sharp(png).jpeg({ quality: jpegQuality, chromaSubsampling: '4:4:4' }).toBuffer();
    mime = 'image/jpeg';
  } else {
    bytes = await sharp(png).webp({ quality: jpegQuality, smartSubsample: true }).toBuffer();
    mime = 'image/webp';
  }
  return { bytes, dataUrl: `data:${mime};base64,${bytes.toString('base64')}` };
}

function selectorHtml(imageDataUrl: string, token: string, aspectPreset: RegionAspectPreset): string {
  const safeImage = JSON.stringify(imageDataUrl);
  const safeToken = JSON.stringify(token);
  const safePreset = JSON.stringify(aspectPreset);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>KNOUX Region Capture</title>
<style>
:root{color-scheme:dark;font-family:Segoe UI,Arial,sans-serif}*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;user-select:none;cursor:crosshair;background:#05030b}#source{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none}.veil{position:absolute;border:1px solid #00efff;box-shadow:0 0 0 99999px rgba(2,2,8,.60),0 0 30px rgba(0,239,255,.55);display:none;cursor:move}.veil.active{display:block}.handle{position:absolute;width:13px;height:13px;background:#fff;border:2px solid #00d9ff;border-radius:50%;box-shadow:0 0 12px #00d9ff}.nw{left:-7px;top:-7px;cursor:nwse-resize}.n{left:calc(50% - 7px);top:-7px;cursor:ns-resize}.ne{right:-7px;top:-7px;cursor:nesw-resize}.e{right:-7px;top:calc(50% - 7px);cursor:ew-resize}.se{right:-7px;bottom:-7px;cursor:nwse-resize}.s{left:calc(50% - 7px);bottom:-7px;cursor:ns-resize}.sw{left:-7px;bottom:-7px;cursor:nesw-resize}.w{left:-7px;top:calc(50% - 7px);cursor:ew-resize}.cross-x,.cross-y{position:absolute;background:rgba(0,239,255,.72);pointer-events:none}.cross-x{height:1px;left:0;right:0}.cross-y{width:1px;top:0;bottom:0}.hud{position:absolute;min-width:230px;padding:10px 13px;border:1px solid rgba(0,239,255,.45);border-radius:10px;background:rgba(4,3,13,.88);box-shadow:0 14px 34px rgba(0,0,0,.45);backdrop-filter:blur(14px);font-size:13px;line-height:1.45;pointer-events:none}.hud strong{color:#63f5ff}.help{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);padding:8px 14px;border-radius:999px;background:rgba(3,2,10,.82);border:1px solid rgba(255,255,255,.18);font-size:12px;white-space:nowrap}.magnifier{position:absolute;width:124px;height:124px;border:2px solid #fff;border-radius:50%;box-shadow:0 8px 30px rgba(0,0,0,.6),0 0 20px rgba(0,239,255,.5);background-repeat:no-repeat;pointer-events:none;overflow:hidden}.magnifier::after{content:'';position:absolute;left:50%;top:50%;width:20px;height:20px;transform:translate(-50%,-50%);border:1px solid #ff2bd6}.badge{position:absolute;top:16px;left:16px;padding:8px 12px;border-radius:8px;background:rgba(4,3,13,.88);border:1px solid rgba(255,255,255,.18);font-weight:600}.badge span{color:#00efff}
</style>
</head>
<body>
<img id="source" alt="" src=${safeImage} />
<div id="selection" class="veil"><i class="handle nw" data-handle="nw"></i><i class="handle n" data-handle="n"></i><i class="handle ne" data-handle="ne"></i><i class="handle e" data-handle="e"></i><i class="handle se" data-handle="se"></i><i class="handle s" data-handle="s"></i><i class="handle sw" data-handle="sw"></i><i class="handle w" data-handle="w"></i></div>
<div id="crossX" class="cross-x"></div><div id="crossY" class="cross-y"></div>
<div id="hud" class="hud"><strong>KNOUX Region</strong><div id="coords">Drag to select</div></div>
<div id="magnifier" class="magnifier"></div>
<div class="badge">Aspect: <span id="aspect"></span></div>
<div class="help">Drag: select · 8 handles: resize · Arrows: move · Shift+Arrows: resize · Enter/double-click: capture · Right-click/Menu: actions · Esc: cancel</div>
<script>
(() => {
 const api=window.knouxCreativeAPI?.capture; const token=${safeToken}; const preset=${safePreset};
 const ratios={free:null,'1:1':1,'4:3':4/3,'16:9':16/9,'9:16':9/16,'21:9':21/9}; const ratio=ratios[preset];
 const selection=document.getElementById('selection'),coords=document.getElementById('coords'),hud=document.getElementById('hud'),mag=document.getElementById('magnifier'),crossX=document.getElementById('crossX'),crossY=document.getElementById('crossY');
 document.getElementById('aspect').textContent=preset;
 let rect={x:0,y:0,width:0,height:0},action='new',handle='',start={x:0,y:0},origin={...rect};
 const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
 const normalize=(a,b)=>({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(b.x-a.x),height:Math.abs(b.y-a.y)});
 const applyRatio=(candidate,anchor)=>{if(!ratio)return candidate;let w=candidate.width,h=candidate.height;if(w/Math.max(1,h)>ratio)h=w/ratio;else w=h*ratio;return {x:anchor.x<candidate.x+candidate.width/2?candidate.x+candidate.width-w:candidate.x,y:anchor.y<candidate.y+candidate.height/2?candidate.y+candidate.height-h:candidate.y,width:w,height:h}};
 const constrain=(r)=>{let x=clamp(r.x,0,innerWidth-1),y=clamp(r.y,0,innerHeight-1),w=clamp(r.width,1,innerWidth-x),h=clamp(r.height,1,innerHeight-y);return{x:Math.round(x),y:Math.round(y),width:Math.round(w),height:Math.round(h)}};
 const render=()=>{selection.classList.toggle('active',rect.width>1&&rect.height>1);Object.assign(selection.style,{left:rect.x+'px',top:rect.y+'px',width:rect.width+'px',height:rect.height+'px'});coords.textContent='X '+rect.x+'  Y '+rect.y+'  W '+rect.width+'  H '+rect.height;hud.style.left=clamp(rect.x,8,innerWidth-245)+'px';hud.style.top=clamp(rect.y-62,8,innerHeight-72)+'px'};
 const pointer=(e)=>({x:clamp(e.clientX,0,innerWidth),y:clamp(e.clientY,0,innerHeight)});
 addEventListener('pointerdown',(e)=>{start=pointer(e);origin={...rect};handle=e.target?.dataset?.handle||'';if(handle)action='resize';else if(e.target===selection)action='move';else action='new';if(action==='new'){rect={x:start.x,y:start.y,width:1,height:1};render()} e.preventDefault()});
 addEventListener('pointermove',(e)=>{const p=pointer(e);crossX.style.top=p.y+'px';crossY.style.left=p.x+'px';mag.style.left=clamp(p.x+22,8,innerWidth-132)+'px';mag.style.top=clamp(p.y+22,8,innerHeight-132)+'px';mag.style.backgroundImage='url('+${safeImage}+')';mag.style.backgroundSize=(innerWidth*4)+'px '+(innerHeight*4)+'px';mag.style.backgroundPosition=(-p.x*4+62)+'px '+(-p.y*4+62)+'px';if(!e.buttons)return;if(action==='new'){rect=constrain(applyRatio(normalize(start,p),start))}else if(action==='move'){rect=constrain({...origin,x:origin.x+p.x-start.x,y:origin.y+p.y-start.y})}else{let left=origin.x,top=origin.y,right=origin.x+origin.width,bottom=origin.y+origin.height;if(handle.includes('w'))left=p.x;if(handle.includes('e'))right=p.x;if(handle.includes('n'))top=p.y;if(handle.includes('s'))bottom=p.y;rect=constrain(applyRatio(normalize({x:left,y:top},{x:right,y:bottom}),{x:handle.includes('w')?right:left,y:handle.includes('n')?bottom:top}))}render();e.preventDefault()});
 const complete=(activation)=>{if(rect.width>1&&rect.height>1)api?.completeRegionSelection({...rect,token,activation})};
 addEventListener('keydown',(e)=>{if(e.key==='Escape'){api?.cancelRegionSelection(token);return}if(e.key==='Enter'&&rect.width>1&&rect.height>1){complete('capture');return}if((e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10'))&&rect.width>1&&rect.height>1){e.preventDefault();complete('action-menu');return}const moves={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};const move=moves[e.key];if(!move)return;e.preventDefault();const step=e.altKey?10:1;if(e.shiftKey)rect=constrain({...rect,width:rect.width+move[0]*step,height:rect.height+move[1]*step});else rect=constrain({...rect,x:rect.x+move[0]*step,y:rect.y+move[1]*step});render()});
 addEventListener('dblclick',(e)=>{e.preventDefault();complete('capture')});
 addEventListener('contextmenu',(e)=>{e.preventDefault();complete('action-menu')}); render();
})();
</script>
</body></html>`;
}

export class RegionCaptureService {
  private selectorWindow: BrowserWindow | null = null;
  private readonly retained = new RetainedCaptureStore();
  private readonly consents = new CaptureConsentStore();
  private readonly googleAdapter = trustedSprint02GoogleAdapter() ?? new GoogleImageSearchAdapter();

  constructor(
    private readonly ipc: IpcRegistrar,
    private readonly captureService: CaptureService,
  ) {}

  async execute(operation: DesktopCaptureOperation): Promise<DesktopCaptureOperationResult> {
    if ('operation' in operation) {
      if (operation.operation === 'list-retained') return this.retained.list();
      if (operation.operation === 'create-upload-consent') {
        const retained = this.retained.get(operation.retainedId).summary;
        return this.consents.create(operation.provider, retained.id, retained.sha256, retained.bytes);
      }
      if (operation.operation === 'resolve-upload-consent') {
        const consent = this.consents.consume(operation.consentId, operation.accepted);
        if (!consent) return { declined: true };
        const retained = this.retained.get(consent.retainedId);
        if (retained.summary.sha256 !== consent.sha256) throw new Error('Retained capture changed after consent was granted.');
        return this.googleAdapter.upload(consent.provider, retained.buffer, retained.summary.mimeType);
      }
      if (operation.operation !== 'retained-action' || typeof operation.retainedId !== 'string') throw new TypeError('Retained capture operation is invalid.');
      if (operation.action === 'get') {
        const retained = this.retained.get(operation.retainedId);
        return { summary: retained.summary, dataUrl: retained.dataUrl };
      }
      if (operation.action === 'copy') {
        const retained = this.retained.get(operation.retainedId);
        const image = nativeImage.createFromBuffer(retained.buffer);
        if (image.isEmpty()) throw new Error('Retained capture could not be copied.');
        clipboard.writeImage(image);
        return retained.summary;
      }
      if (operation.action === 'pin') return this.retained.pin(operation.retainedId);
      if (operation.action === 'unpin') return this.retained.unpin(operation.retainedId);
      if (operation.action === 'delete') {
        this.consents.invalidateRetained(operation.retainedId);
        return { deleted: this.retained.delete(operation.retainedId) };
      }
      throw new TypeError('Retained capture action is invalid.');
    }
    return this.capture(operation);
  }

  async capture(rawRequest: DesktopCaptureRequest): Promise<DesktopCaptureResult | null> {
    const request = validateRequest(rawRequest);
    if (this.selectorWindow && !this.selectorWindow.isDestroyed()) throw new Error('A KNOUX region selector is already active.');
    if ((request.delaySeconds ?? 0) > 0) await delay((request.delaySeconds ?? 0) * 1000);

    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: maximumPhysicalCaptureSize(),
      fetchWindowIcons: false,
    });
    const source = sources.find((candidate) => candidate.id === request.sourceId);
    if (!source) throw new Error('The selected desktop capture source is no longer available.');
    if (source.thumbnail.isEmpty()) throw new Error('The selected desktop source returned an empty image.');

    const sourceSize = source.thumbnail.getSize();
    if (sourceSize.width <= 0 || sourceSize.height <= 0) throw new Error('The selected desktop source has invalid dimensions.');
    const display = displayForSource(source.display_id);
    const logicalBounds = request.sourceId.startsWith('screen:')
      ? { x: 0, y: 0, width: display.bounds.width, height: display.bounds.height }
      : { x: 0, y: 0, width: sourceSize.width, height: sourceSize.height };

    const selectionResult = request.mode === 'region'
      ? await this.selectRegion(display, source.thumbnail.toDataURL(), request.aspectPreset ?? 'free')
      : { rectangle: logicalBounds, activation: 'capture' as const };
    if (!selectionResult) return null;

    const normalized = sanitizedRectangle(selectionResult.rectangle, logicalBounds);
    const scaleX = sourceSize.width / logicalBounds.width;
    const scaleY = sourceSize.height / logicalBounds.height;
    const pixelSelection = sanitizedRectangle({
      x: Math.floor(normalized.x * scaleX),
      y: Math.floor(normalized.y * scaleY),
      width: Math.ceil(normalized.width * scaleX),
      height: Math.ceil(normalized.height * scaleY),
    }, { x: 0, y: 0, width: sourceSize.width, height: sourceSize.height });

    const cropped = source.thumbnail.crop(pixelSelection);
    if (cropped.isEmpty()) throw new Error('The selected desktop region produced an empty image.');
    const encoded = await encodeImage(cropped, request.format, request.jpegQuality ?? 92);

    if (request.copyToClipboard) {
      const clipboardImage = nativeImage.createFromBuffer(encoded.bytes);
      if (clipboardImage.isEmpty()) throw new Error('The selected desktop region could not be copied.');
      clipboard.writeImage(clipboardImage);
    }

    const outputPath = request.save
      ? await this.captureService.saveFrame({
        dataUrl: encoded.dataUrl,
        mediaName: source.name || 'desktop-capture',
        timestampSeconds: 0,
        format: request.format,
      })
      : null;

    const retained = this.retained.insert(encoded.bytes, {
      sourceId: source.id,
      sourceName: source.name,
      displayId: source.display_id || null,
      format: request.format,
      width: cropped.getSize().width,
      height: cropped.getSize().height,
      outputPath,
    });

    return {
      retained,
      sourceId: source.id,
      sourceName: source.name,
      displayId: source.display_id || null,
      mode: request.mode,
      format: request.format,
      dataUrl: encoded.dataUrl,
      outputPath,
      selection: normalized,
      pixelSelection,
      imageSize: sourceSize,
      scale: { x: scaleX, y: scaleY },
      openActionMenu: selectionResult.activation === 'action-menu',
    };
  }

  close(): void {
    const window = this.selectorWindow;
    this.selectorWindow = null;
    if (window && !window.isDestroyed()) window.destroy();
    this.retained.clear();
    this.consents.clear();
  }

  private async selectRegion(display: Display, imageDataUrl: string, aspectPreset: RegionAspectPreset): Promise<SelectorResult | null> {
    const token = randomUUID();
    const preloadPath = resolveTrustedPreloadPath();
    const window = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      show: false,
      frame: false,
      transparent: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      backgroundColor: '#05030b',
      webPreferences: {
        ...SECURE_RENDERER_PREFERENCES,
        preload: preloadPath,
        spellcheck: false,
      },
    });
    this.selectorWindow = window;
    window.setAlwaysOnTop(true, 'screen-saver');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    return new Promise<SelectorResult | null>((resolve, reject) => {
      let settled = false;
      const settle = (value: SelectorResult | null, error?: Error): void => {
        if (settled) return;
        settled = true;
        this.ipc.removeListener(COMPLETE_CHANNEL, complete);
        this.ipc.removeListener(CANCEL_CHANNEL, cancel);
        if (this.selectorWindow === window) this.selectorWindow = null;
        if (!window.isDestroyed()) window.destroy();
        if (error) reject(error);
        else resolve(value);
      };
      const complete = (event: IpcMainEvent, payload: SelectorPayload): void => {
        if (event.sender !== window.webContents || payload?.token !== token) return;
        try {
          settle({
            rectangle: sanitizedRectangle(payload, { x: 0, y: 0, width: display.bounds.width, height: display.bounds.height }),
            activation: payload.activation === 'action-menu' ? 'action-menu' : 'capture',
          });
        } catch (error) {
          settle(null, error instanceof Error ? error : new Error('Region selection is invalid.'));
        }
      };
      const cancel = (event: IpcMainEvent, payloadToken: string): void => {
        if (event.sender === window.webContents && payloadToken === token) settle(null);
      };
      this.ipc.on(COMPLETE_CHANNEL, complete);
      this.ipc.on(CANCEL_CHANNEL, cancel);
      window.once('closed', () => settle(null));
      window.webContents.once('did-fail-load', (_event, code, description) => {
        settle(null, new Error(`Region selector failed to load (${code}): ${description}`));
      });
      window.once('ready-to-show', () => {
        window.show();
        window.focus();
      });
      void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(selectorHtml(imageDataUrl, token, aspectPreset))}`)
        .catch((error) => settle(null, error instanceof Error ? error : new Error('Region selector failed to load.')));
    });
  }
}
