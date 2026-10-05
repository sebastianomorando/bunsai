import { describe, expect, test } from 'bun:test';
import { avatarCropRectangle, panAvatarCrop, supportedAvatarBytes, validAvatarFile, MAX_AVATAR_PIXELS, MAX_AVATAR_FILE_BYTES } from './avatarCrop';
import { fetchAvatarSource, uploadAsset } from './api';
import { assetsState, sessionState } from './state';

describe('avatar cropping',()=>{
  test('keeps a square source area within landscape and portrait images at any pan/zoom',()=>{
    for(const [width,height] of [[1600,900],[900,1600],[512,512]]) {
      for(const zoom of [1,2,4,100])for(const x of [-10,0,0.5,1,10])for(const y of [-10,0,0.5,1,10]) {
        const crop=avatarCropRectangle(width!,height!,{x,y,zoom});
        expect(crop.x).toBeGreaterThanOrEqual(0);expect(crop.y).toBeGreaterThanOrEqual(0);
        expect(crop.x+crop.size).toBeLessThanOrEqual(width!);expect(crop.y+crop.size).toBeLessThanOrEqual(height!);
        expect(crop.size).toBeGreaterThan(0);
      }
    }
    expect(avatarCropRectangle(1600,900,{x:0.5,y:0.5,zoom:1})).toEqual({x:350,y:0,size:900});
  });
  test('rejects oversized or invalid dimensions and bounds pointer movement',()=>{
    for(const [width,height] of [[0,1],[-1,1],[Infinity,1],[NaN,1],[MAX_AVATAR_PIXELS,2]]) expect(()=>avatarCropRectangle(width!,height!,{x:0.5,y:0.5,zoom:1})).toThrow();
    expect(()=>avatarCropRectangle(100,100,{x:NaN,y:0.5,zoom:1})).toThrow();
    expect(panAvatarCrop(800,400,{x:0.5,y:0.5,zoom:1},100000,-100000,320)).toEqual({x:0,y:0.5,zoom:1});
    expect(panAvatarCrop(512,512,{x:0.5,y:0.5,zoom:1},100,100,320)).toEqual({x:0.5,y:0.5,zoom:1});
  });
  test('rejects empty/oversized files, SVG/HTML and disguised non-raster content',()=>{
    for(const file of [{size:0,type:'image/png'},{size:21*1024*1024,type:'image/png'},{size:100,type:'image/svg+xml'},{size:100,type:'text/html'}])expect(validAvatarFile(file)).toBe(false);
    expect(validAvatarFile({size:100,type:'image/jpeg'})).toBe(true);
    expect(supportedAvatarBytes(new TextEncoder().encode('<svg onload="alert(1)">'))).toBe(false);
    expect(supportedAvatarBytes(new TextEncoder().encode('<html>'))).toBe(false);
    expect(supportedAvatarBytes(new Uint8Array([137,80,78,71,13,10,26,10]))).toBe(true);
    expect(supportedAvatarBytes(new Uint8Array([255,216,255]))).toBe(true);
  });
  test('only downloads internal asset URLs and cancels oversized streams even without Content-Length',async()=>{
    const originalFetch=globalThis.fetch;let requested=0,cancelled=false;
    globalThis.fetch=((input,...args)=>{
      if(typeof input==='string'&&input.startsWith('/assets/')) {
        requested++;return Promise.resolve(new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(MAX_AVATAR_FILE_BYTES+1));},cancel(){cancelled=true;}}),{headers:{'Content-Type':'image/webp'}}));
      }
      return originalFetch(input,...args);
    }) as typeof fetch;
    try {
      await expect(fetchAvatarSource('https://attacker.example/image')).rejects.toThrow();expect(requested).toBe(0);
      await expect(fetchAvatarSource('12345678-1234-1234-1234-123456789abc')).rejects.toThrow();
      expect(requested).toBe(1);expect(cancelled).toBe(true);
    } finally {globalThis.fetch=originalFetch;}
  });
  test('does not repopulate asset state when a pending upload completes after a session change',async()=>{
    const originalFetch=globalThis.fetch;
    const previousSession=sessionState.value;
    const previousAssets=assetsState.value;
    let complete!: (response:Response)=>void;
    const response=new Promise<Response>(resolve=>complete=resolve);
    globalThis.fetch=((input,...args)=>input==='/api/assets'?response:originalFetch(input,...args)) as typeof fetch;
    try {
      sessionState.value={userId:'first-user',expiresAt:null};assetsState.value=[];
      const upload=uploadAsset(new File(['test'],'photo.png',{type:'image/png'}));
      sessionState.value={userId:'other-user',expiresAt:null};
      complete(Response.json({id:'asset',uploadedBy:'first-user'}));await upload;
      expect(assetsState.value).toEqual([]);
    } finally {globalThis.fetch=originalFetch;sessionState.value=previousSession;assetsState.value=previousAssets;}
  });
});
