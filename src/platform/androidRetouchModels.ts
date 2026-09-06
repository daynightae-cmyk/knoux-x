interface VerifiedModelManifest {
  id: string;
  url: string;
  sha256: string;
  sizeBytes: number;
}

const FACE_MODEL: VerifiedModelManifest = {
  id: 'mediapipe-face-landmarker',
  url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
  sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
  sizeBytes: 3_758_596,
};

const POSE_MODEL: VerifiedModelManifest = {
  id: 'mediapipe-pose-landmarker-full',
  url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
  sha256: '4eaa5eb7a98365221087693fcc286334cf0858e2eb6e15b506aa4a7ecdcec4ad',
  sizeBytes: 9_398_198,
};

const memoryCache = new Map<string, Uint8Array>();

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function verify(bytes: Uint8Array, manifest: VerifiedModelManifest): Promise<void> {
  if (bytes.byteLength !== manifest.sizeBytes) {
    throw new Error(`${manifest.id} size mismatch: expected ${manifest.sizeBytes}, got ${bytes.byteLength}.`);
  }
  if (!crypto.subtle) throw new Error('WebCrypto SHA-256 is unavailable in this Android WebView.');
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  const actual = hex(digest);
  if (actual !== manifest.sha256) throw new Error(`${manifest.id} SHA-256 verification failed.`);
}

async function readCachedResponse(manifest: VerifiedModelManifest): Promise<Uint8Array | null> {
  if (!('caches' in window)) return null;
  try {
    const cache = await caches.open('knoux-android-retouch-models-v1');
    const response = await cache.match(manifest.url);
    if (!response?.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    await verify(bytes, manifest);
    return bytes;
  } catch {
    return null;
  }
}

async function cacheVerifiedResponse(manifest: VerifiedModelManifest, response: Response): Promise<void> {
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open('knoux-android-retouch-models-v1');
    await cache.put(manifest.url, response);
  } catch {
    // Runtime memory cache is sufficient when Cache Storage is unavailable.
  }
}

async function loadVerifiedModel(manifest: VerifiedModelManifest): Promise<Uint8Array> {
  const memory = memoryCache.get(manifest.id);
  if (memory) return new Uint8Array(memory);

  const cached = await readCachedResponse(manifest);
  if (cached) {
    memoryCache.set(manifest.id, cached);
    return new Uint8Array(cached);
  }

  const response = await fetch(manifest.url, {
    method: 'GET',
    mode: 'cors',
    credentials: 'omit',
    cache: 'force-cache',
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`${manifest.id} download failed with HTTP ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await verify(bytes, manifest);
  memoryCache.set(manifest.id, bytes);
  await cacheVerifiedResponse(manifest, new Response(bytes.slice().buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(bytes.byteLength),
      'X-KNOUX-SHA256': manifest.sha256,
    },
  }));
  return new Uint8Array(bytes);
}

async function modelResult(manifest: VerifiedModelManifest): Promise<{
  status: string;
  modelId: string;
  reason?: string;
  buffer?: Uint8Array;
}> {
  try {
    const buffer = await loadVerifiedModel(manifest);
    return { status: 'ready', modelId: manifest.id, buffer };
  } catch (error) {
    return {
      status: 'unavailable',
      modelId: manifest.id,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function installAndroidRetouchModels(): void {
  if (window.knouxRuntime?.edition !== 'android' || typeof window.knouxImageStudioAPI === 'undefined') return;
  const base = window.knouxImageStudioAPI;
  window.knouxImageStudioAPI = {
    ...base,
    getVerifiedFaceModel: async () => modelResult(FACE_MODEL),
    getVerifiedPoseModel: async () => modelResult(POSE_MODEL),
  } as Window['knouxImageStudioAPI'];
}
