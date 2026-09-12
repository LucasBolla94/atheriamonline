import { describe, expect, it, vi } from 'vitest';
import { preferCanvasRenderer } from './renderer.js';

function probe(renderer: string, hidden = false, cleanupThrows = false) {
  const loseContext = vi.fn();
  const getContext = vi.fn(() => ({
    getExtension: (name: string) => {
      if (name === 'WEBGL_debug_renderer_info')
        return hidden ? null : { UNMASKED_RENDERER_WEBGL: 1 };
      if (cleanupThrows) throw new Error('Context unavailable');
      return { loseContext };
    },
    getParameter: () => renderer,
  }));
  const makeCanvas = () => ({ getContext }) as unknown as HTMLCanvasElement;
  return { makeCanvas, loseContext };
}

describe('renderer capability selection', () => {
  it.each(['ANGLE SwiftShader Device', 'Mesa llvmpipe', 'Mesa softpipe'])(
    'uses native Canvas for the software renderer %s and releases the probe',
    (name) => {
      const p = probe(name);
      expect(preferCanvasRenderer(p.makeCanvas)).toBe(true);
      expect(p.loseContext).toHaveBeenCalledOnce();
    },
  );
  it('keeps hardware acceleration available', () => {
    const p = probe('ANGLE Intel UHD Graphics');
    expect(preferCanvasRenderer(p.makeCanvas)).toBe(false);
    expect(p.loseContext).toHaveBeenCalledOnce();
  });
  it('respects browsers which hide the renderer identity', () => {
    expect(preferCanvasRenderer(probe('', true).makeCanvas)).toBe(false);
  });
  it('uses Canvas when WebGL cannot be created', () => {
    expect(
      preferCanvasRenderer(() => ({ getContext: () => null }) as unknown as HTMLCanvasElement),
    ).toBe(true);
    expect(
      preferCanvasRenderer(() => {
        throw new Error('Unavailable');
      }),
    ).toBe(true);
  });
  it('still starts the game if releasing the probe fails', () => {
    expect(preferCanvasRenderer(probe('SwiftShader', false, true).makeCanvas)).toBe(true);
    expect(preferCanvasRenderer(probe('Intel UHD', false, true).makeCanvas)).toBe(false);
  });
});
