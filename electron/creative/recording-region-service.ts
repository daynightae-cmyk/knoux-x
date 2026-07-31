import path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  BrowserWindow,
  desktopCapturer,
  screen,
  type IpcMain,
  type IpcMainEvent,
  type Rectangle,
} from 'electron';

import type { RegionAspectPreset } from './region-capture-service';

export interface RecordingRegionSelection {
  sourceId: string;
  sourceName: string;
  displayId: string;
  selection: Rectangle;
  logicalSize: { width: number; height: number };
}

interface SelectorPayload extends Rectangle {
  token: string;
}

const COMPLETE_CHANNEL = 'recording:selector-complete';
const CANCEL_CHANNEL = 'recording:selector-cancel';
const MAX_SELECTION_AREA = 134_217_728;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function sanitizeRectangle(value: Partial<Rectangle>, bounds: Rectangle): Rectangle {
  const x = clamp(Math.round(Number(value.x) || 0), 0, Math.max(0, bounds.width - 1));
  const y = clamp(Math.round(Number(value.y) || 0), 0, Math.max(0, bounds.height - 1));
  const width = clamp(Math.round(Number(value.width) || 0), 1, bounds.width - x);
  const height = clamp(Math.round(Number(value.height) || 0), 1, bounds.height - y);
  if (width * height > MAX_SELECTION_AREA) throw new RangeError('Recording region is too large.');
  return { x, y, width, height };
}

function selectorHtml(imageDataUrl: string, token: string, aspectPreset: RegionAspectPreset): string {
  const image = JSON.stringify(imageDataUrl);
  const selectorToken = JSON.stringify(token);
  const preset = JSON.stringify(aspectPreset);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>KNOUX Recording Region</title>
<style>
:root{color-scheme:dark;font-family:Segoe UI,Arial,sans-serif}*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;user-select:none;background:#05030b;cursor:crosshair}#source{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none}.selection{position:absolute;display:none;border:2px solid #ff2bd6;box-shadow:0 0 0 99999px rgba(2,2,8,.62),0 0 34px rgba(255,43,214,.58);cursor:move}.selection.active{display:block}.handle{position:absolute;width:14px;height:14px;border-radius:50%;background:#fff;border:2px solid #00efff}.nw{left:-8px;top:-8px;cursor:nwse-resize}.ne{right:-8px;top:-8px;cursor:nesw-resize}.sw{left:-8px;bottom:-8px;cursor:nesw-resize}.se{right:-8px;bottom:-8px;cursor:nwse-resize}.cross-x,.cross-y{position:absolute;background:rgba(0,239,255,.7);pointer-events:none}.cross-x{height:1px;left:0;right:0}.cross-y{width:1px;top:0;bottom:0}.hud{position:absolute;padding:10px 13px;border-radius:10px;background:rgba(4,3,13,.9);border:1px solid rgba(255,43,214,.55);box-shadow:0 12px 30px rgba(0,0,0,.5);font-size:13px;pointer-events:none}.hud strong{color:#ff70e4}.help{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);padding:9px 16px;border-radius:999px;background:rgba(4,3,13,.88);border:1px solid rgba(255,255,255,.18);font-size:12px;white-space:nowrap}.badge{position:absolute;top:16px;left:16px;padding:8px 12px;border-radius:8px;background:rgba(4,3,13,.88);border:1px solid rgba(255,255,255,.18)}.badge span{color:#00efff}
</style></head><body>
<img id="source" alt="" src=${image} />
<div id="selection" class="selection"><i class="handle nw" data-handle="nw"></i><i class="handle ne" data-handle="ne"></i><i class="handle sw" data-handle="sw"></i><i class="handle se" data-handle="se"></i></div>
<div id="crossX" class="cross-x"></div><div id="crossY" class="cross-y"></div>
<div id="hud" class="hud"><strong>KNOUX Recording Region</strong><div id="coords">Drag to select</div></div>
<div class="badge">Aspect: <span id="aspect"></span></div>
<div class="help">Drag: select · Drag inside: move · Handles: resize · Arrows: move · Shift+Arrows: resize · Enter: use region · Esc: cancel</div>
<script>(()=>{
 const api=window.knouxCreativeAPI?.recording; const token=${selectorToken}; const preset=${preset};
 const ratios={free:null,'1:1':1,'4:3':4/3,'16:9':16/9,'9:16':9/16,'21:9':21/9}; const ratio=ratios[preset];
 const selection=document.getElementById('selection'),coords=document.getElementById('coords'),hud=document.getElementById('hud'),crossX=document.getElementById('crossX'),crossY=document.getElementById('crossY'); document.getElementById('aspect').textContent=preset;
 let rect={x:0,y:0,width:0,height:0},action='new',handle='',start={x:0,y:0},origin={...rect};
 const clamp=(v,min,max)=>Math.max(min,Math.min(max,v)); const point=(e)=>({x:clamp(e.clientX,0,innerWidth),y:clamp(e.clientY,0,innerHeight)});
 const normalize=(a,b)=>({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(b.x-a.x),height:Math.abs(b.y-a.y)});
 const applyRatio=(candidate,anchor)=>{if(!ratio)return candidate;let w=candidate.width,h=candidate.height;if(w/Math.max(1,h)>ratio)h=w/ratio;else w=h*ratio;return{x:anchor.x<candidate.x+candidate.width/2?candidate.x+candidate.width-w:candidate.x,y:anchor.y<candidate.y+candidate.height/2?candidate.y+candidate.height-h:candidate.y,width:w,height:h}};
 const constrain=(r)=>{const x=clamp(r.x,0,innerWidth-1),y=clamp(r.y,0,innerHeight-1);return{x:Math.round(x),y:Math.round(y),width:Math.round(clamp(r.width,1,innerWidth-x)),height:Math.round(clamp(r.height,1,innerHeight-y))}};
 const render=()=>{selection.classList.toggle('active',rect.width>1&&rect.height>1);Object.assign(selection.style,{left:rect.x+'px',top:rect.y+'px',width:rect.width+'px',height:rect.height+'px'});coords.textContent='X '+rect.x+'  Y '+rect.y+'  W '+rect.width+'  H '+rect.height;hud.style.left=clamp(rect.x,8,innerWidth-245)+'px';hud.style.top=clamp(rect.y-62,8,innerHeight-72)+'px'};
 addEventListener('pointerdown',(e)=>{start=point(e);origin={...rect};handle=e.target?.dataset?.handle||'';if(handle)action='resize';else if(e.target===selection)action='move';else action='new';if(action==='new')rect={x:start.x,y:start.y,width:1,height:1};render();e.preventDefault()});
 addEventListener('pointermove',(e)=>{const p=point(e);crossX.style.top=p.y+'px';crossY.style.left=p.x+'px';if(!e.buttons)return;if(action==='new')rect=constrain(applyRatio(normalize(start,p),start));else if(action==='move')rect=constrain({...origin,x:origin.x+p.x-start.x,y:origin.y+p.y-start.y});else{let l=origin.x,t=origin.y,r=origin.x+origin.width,b=origin.y+origin.height;if(handle.includes('w'))l=p.x;if(handle.includes('e'))r=p.x;if(handle.includes('n'))t=p.y;if(handle.includes('s'))b=p.y;rect=constrain(applyRatio(normalize({x:l,y:t},{x:r,y:b}),{x:handle.includes('w')?r:l,y:handle.includes('n')?b:t}))}render();e.preventDefault()});
 addEventListener('keydown',(e)=>{if(e.key==='Escape'){api?.cancelRegionSelection(token);return}if(e.key==='Enter'&&rect.width>1&&rect.height>1){api?.completeRegionSelection({...rect,token});return}const moves={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};const move=moves[e.key];if(!move)return;e.preventDefault();const step=e.altKey?10:1;if(e.shiftKey)rect=constrain({...rect,width:rect.width+move[0]*step,height:rect.height+move[1]*step});else rect=constrain({...rect,x:rect.x+move[0]*step,y:rect.y+move[1]*step});render()});
 addEventListener('contextmenu',(e)=>e.preventDefault());render();
})();</script></body></html>`;
}

export class RecordingRegionService {
  private selectorWindow: BrowserWindow | null = null;

  constructor(private readonly ipc: IpcMain) {}

  async select(sourceId: string, aspectPreset: RegionAspectPreset = 'free'): Promise<RecordingRegionSelection | null> {
    if (!sourceId.startsWith('screen:')) throw new Error('Custom recording regions require a display source.');
    if (!['free', '1:1', '4:3', '16:9', '9:16', '21:9'].includes(aspectPreset)) {
      throw new TypeError('Recording region aspect preset is invalid.');
    }
    if (this.selectorWindow && !this.selectorWindow.isDestroyed()) throw new Error('A recording region selector is already active.');

    const displaySources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 7680, height: 4320 },
      fetchWindowIcons: false,
    });
    const source = displaySources.find((candidate) => candidate.id === sourceId);
    if (!source || source.thumbnail.isEmpty()) throw new Error('The selected display is no longer available.');
    const display = screen.getAllDisplays().find((candidate) => String(candidate.id) === source.display_id)
      ?? screen.getPrimaryDisplay();
    const selection = await this.openSelector(display.bounds, source.thumbnail.toDataURL(), aspectPreset);
    if (!selection) return null;
    return {
      sourceId: source.id,
      sourceName: source.name,
      displayId: source.display_id,
      selection,
      logicalSize: { width: display.bounds.width, height: display.bounds.height },
    };
  }

  close(): void {
    const window = this.selectorWindow;
    this.selectorWindow = null;
    if (window && !window.isDestroyed()) window.destroy();
  }

  private async openSelector(bounds: Rectangle, imageDataUrl: string, aspectPreset: RegionAspectPreset): Promise<Rectangle | null> {
    const token = randomUUID();
    const window = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      show: false,
      frame: false,
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
        preload: path.join(__dirname, 'preload-entry.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
      },
    });
    this.selectorWindow = window;
    window.setAlwaysOnTop(true, 'screen-saver');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    return new Promise<Rectangle | null>((resolve, reject) => {
      let settled = false;
      const settle = (value: Rectangle | null, error?: Error): void => {
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
          settle(sanitizeRectangle(payload, { x: 0, y: 0, width: bounds.width, height: bounds.height }));
        } catch (error) {
          settle(null, error instanceof Error ? error : new Error('Recording region selection is invalid.'));
        }
      };
      const cancel = (event: IpcMainEvent, payloadToken: string): void => {
        if (event.sender === window.webContents && payloadToken === token) settle(null);
      };
      this.ipc.on(COMPLETE_CHANNEL, complete);
      this.ipc.on(CANCEL_CHANNEL, cancel);
      window.once('closed', () => settle(null));
      window.webContents.once('did-fail-load', (_event, code, description) => {
        settle(null, new Error(`Recording region selector failed to load (${code}): ${description}`));
      });
      window.once('ready-to-show', () => {
        window.show();
        window.focus();
      });
      void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(selectorHtml(imageDataUrl, token, aspectPreset))}`)
        .catch((error) => settle(null, error instanceof Error ? error : new Error('Recording region selector failed to load.')));
    });
  }
}
