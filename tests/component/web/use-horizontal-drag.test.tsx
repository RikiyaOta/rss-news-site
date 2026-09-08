// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  useHorizontalDrag,
  UseHorizontalDragOptions,
} from "../../../src/web/hooks/useHorizontalDrag";

/**
 * フックの戻り値をそのまま要素に適用する検証用コンポーネント
 */
function DragProbe(options: UseHorizontalDragOptions) {
  const handlers = useHorizontalDrag(options);
  return <div data-testid="drag-area" {...handlers} />;
}

interface Point {
  x: number;
  y: number;
}

function point(p: Point) {
  return { clientX: p.x, clientY: p.y };
}

function getArea() {
  return screen.getByTestId("drag-area");
}

describe("useHorizontalDrag フックのテスト", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("横方向に動かすとドラッグが開始され、移動量が通知されること", () => {
    const onDragStart = vi.fn();
    const onDragMove = vi.fn();
    render(<DragProbe onDragStart={onDragStart} onDragMove={onDragMove} />);

    const area = getArea();
    fireEvent.touchStart(area, { touches: [point({ x: 300, y: 400 })] });
    fireEvent.touchMove(area, { touches: [point({ x: 240, y: 405 })] });

    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onDragMove).toHaveBeenCalledWith(-60);
  });

  it("指を離した時点で開始点からの移動量が通知されること", () => {
    const onDragEnd = vi.fn();
    render(<DragProbe onDragEnd={onDragEnd} />);

    const area = getArea();
    fireEvent.touchStart(area, { touches: [point({ x: 100, y: 400 })] });
    fireEvent.touchMove(area, { touches: [point({ x: 260, y: 400 })] });
    fireEvent.touchEnd(area, { changedTouches: [point({ x: 300, y: 400 })] });

    expect(onDragEnd).toHaveBeenCalledTimes(1);
    expect(onDragEnd.mock.calls[0][0].deltaX).toBe(200);
  });

  it("方向ロックのしきい値未満の移動ではドラッグが開始されないこと", () => {
    const onDragStart = vi.fn();
    const onDragMove = vi.fn();
    const onDragEnd = vi.fn();
    render(<DragProbe onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} />);

    const area = getArea();
    fireEvent.touchStart(area, { touches: [point({ x: 300, y: 400 })] });
    fireEvent.touchMove(area, { touches: [point({ x: 295, y: 402 })] });
    fireEvent.touchEnd(area, { changedTouches: [point({ x: 295, y: 402 })] });

    expect(onDragStart).not.toHaveBeenCalled();
    expect(onDragMove).not.toHaveBeenCalled();
    expect(onDragEnd).not.toHaveBeenCalled();
  });

  it("縦方向の移動が支配的な場合はドラッグとして扱われないこと", () => {
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    render(<DragProbe onDragStart={onDragStart} onDragEnd={onDragEnd} />);

    const area = getArea();
    fireEvent.touchStart(area, { touches: [point({ x: 300, y: 600 })] });
    fireEvent.touchMove(area, { touches: [point({ x: 260, y: 300 })] });
    fireEvent.touchEnd(area, { changedTouches: [point({ x: 260, y: 300 })] });

    expect(onDragStart).not.toHaveBeenCalled();
    expect(onDragEnd).not.toHaveBeenCalled();
  });

  it("一度縦方向と確定した後に横へ動かしてもドラッグが開始されないこと", () => {
    const onDragStart = vi.fn();
    render(<DragProbe onDragStart={onDragStart} />);

    const area = getArea();
    fireEvent.touchStart(area, { touches: [point({ x: 300, y: 400 })] });
    // まず縦方向へ動かして方向ロックを縦に確定させる
    fireEvent.touchMove(area, { touches: [point({ x: 302, y: 460 })] });
    // その後に大きく横へ動かしてもドラッグにはならない
    fireEvent.touchMove(area, { touches: [point({ x: 100, y: 460 })] });

    expect(onDragStart).not.toHaveBeenCalled();
  });

  it("enabled が false の場合はドラッグが検出されないこと", () => {
    const onDragStart = vi.fn();
    render(<DragProbe onDragStart={onDragStart} enabled={false} />);

    const area = getArea();
    fireEvent.touchStart(area, { touches: [point({ x: 300, y: 400 })] });
    fireEvent.touchMove(area, { touches: [point({ x: 100, y: 400 })] });

    expect(onDragStart).not.toHaveBeenCalled();
  });

  it("2本指で開始したタッチはドラッグとして扱われないこと", () => {
    const onDragStart = vi.fn();
    render(<DragProbe onDragStart={onDragStart} />);

    const area = getArea();
    fireEvent.touchStart(area, {
      touches: [point({ x: 300, y: 400 }), point({ x: 320, y: 420 })],
    });
    fireEvent.touchMove(area, { touches: [point({ x: 100, y: 400 })] });

    expect(onDragStart).not.toHaveBeenCalled();
  });

  it("ドラッグ中に2本指操作へ移行した場合は中断が通知されること", () => {
    const onDragCancel = vi.fn();
    const onDragEnd = vi.fn();
    render(<DragProbe onDragCancel={onDragCancel} onDragEnd={onDragEnd} />);

    const area = getArea();
    fireEvent.touchStart(area, { touches: [point({ x: 300, y: 400 })] });
    fireEvent.touchMove(area, { touches: [point({ x: 200, y: 400 })] });
    fireEvent.touchMove(area, {
      touches: [point({ x: 180, y: 400 }), point({ x: 260, y: 430 })],
    });
    fireEvent.touchEnd(area, { changedTouches: [point({ x: 100, y: 400 })] });

    expect(onDragCancel).toHaveBeenCalledTimes(1);
    expect(onDragEnd).not.toHaveBeenCalled();
  });

  it("touchcancel でドラッグが中断されること", () => {
    const onDragCancel = vi.fn();
    render(<DragProbe onDragCancel={onDragCancel} />);

    const area = getArea();
    fireEvent.touchStart(area, { touches: [point({ x: 300, y: 400 })] });
    fireEvent.touchMove(area, { touches: [point({ x: 200, y: 400 })] });
    fireEvent.touchCancel(area);

    expect(onDragCancel).toHaveBeenCalledTimes(1);
  });

  it("ドラッグが開始されていない状態での touchcancel では中断が通知されないこと", () => {
    const onDragCancel = vi.fn();
    render(<DragProbe onDragCancel={onDragCancel} />);

    const area = getArea();
    fireEvent.touchStart(area, { touches: [point({ x: 300, y: 400 })] });
    fireEvent.touchCancel(area);

    expect(onDragCancel).not.toHaveBeenCalled();
  });

  it("touchstart なしで touchend のみ発火しても何も通知されないこと", () => {
    const onDragEnd = vi.fn();
    render(<DragProbe onDragEnd={onDragEnd} />);

    fireEvent.touchEnd(getArea(), { changedTouches: [point({ x: 300, y: 400 })] });

    expect(onDragEnd).not.toHaveBeenCalled();
  });

  it("経過時間と移動量からフリック速度が算出されること", () => {
    vi.useFakeTimers();
    const onDragEnd = vi.fn();
    render(<DragProbe onDragEnd={onDragEnd} />);

    const area = getArea();
    fireEvent.touchStart(area, { touches: [point({ x: 300, y: 400 })] });
    vi.advanceTimersByTime(50);
    fireEvent.touchMove(area, { touches: [point({ x: 200, y: 400 })] });
    fireEvent.touchEnd(area, { changedTouches: [point({ x: 200, y: 400 })] });

    // 50ms で 100px 左へ移動したため -2 px/ms
    expect(onDragEnd.mock.calls[0][0].velocityX).toBeCloseTo(-2, 5);
  });

  it("計測時間が短すぎる場合は速度が算出されないこと", () => {
    vi.useFakeTimers();
    const onDragEnd = vi.fn();
    render(<DragProbe onDragEnd={onDragEnd} />);

    const area = getArea();
    fireEvent.touchStart(area, { touches: [point({ x: 300, y: 400 })] });
    // 1 フレーム未満の間に 30px 動いても、過大な速度として扱わない
    vi.advanceTimersByTime(1);
    fireEvent.touchMove(area, { touches: [point({ x: 270, y: 400 })] });
    fireEvent.touchEnd(area, { changedTouches: [point({ x: 270, y: 400 })] });

    expect(onDragEnd.mock.calls[0][0].velocityX).toBe(0);
  });

  it("ゆっくりした移動では速度が小さく算出されること", () => {
    vi.useFakeTimers();
    const onDragEnd = vi.fn();
    render(<DragProbe onDragEnd={onDragEnd} />);

    const area = getArea();
    fireEvent.touchStart(area, { touches: [point({ x: 300, y: 400 })] });
    vi.advanceTimersByTime(100);
    fireEvent.touchMove(area, { touches: [point({ x: 280, y: 400 })] });
    fireEvent.touchEnd(area, { changedTouches: [point({ x: 280, y: 400 })] });

    expect(Math.abs(onDragEnd.mock.calls[0][0].velocityX)).toBeLessThan(0.4);
  });
});
