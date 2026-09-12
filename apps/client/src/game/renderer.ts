/** Select a native 2D fallback when WebGL is being emulated on the CPU. */
export function preferCanvasRenderer(makeCanvas = () => document.createElement('canvas')): boolean {
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = makeCanvas().getContext('webgl', { failIfMajorPerformanceCaveat: true });
    if (!gl) return true;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    // Browsers may hide this extension for privacy. Keep normal WebGL selection
    // when no renderer name is available; never send this local probe anywhere.
    if (!info) return false;
    const name: unknown = gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
    return typeof name === 'string' && /swiftshader|llvmpipe|softpipe/i.test(name);
  } catch {
    return true;
  } finally {
    try {
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      // A lost or privacy-restricted probe must not prevent game startup.
    }
  }
}
