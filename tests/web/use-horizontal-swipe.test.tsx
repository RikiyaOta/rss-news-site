// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  useHorizontalSwipe,
  UseHorizontalSwipeOptions,
} from "../../src/web/hooks/useHorizontalSwipe";

/**
 * フックの戻り値をそのまま要素に適用する検証用コンポーネント
 */
function SwipeProbe(options: UseHorizontalSwipeOptions) {
  const handlers = useHorizontalSwipe(options);
  return <div data-testid="swipe-area" {...handlers} />;
}

interface Point {
  x: number;
  y: number;
}

function point(p: Point) {
  return { clientX: p.x, clientY: p.y };
}

/**
 * touchstart → touchmove → touchend の一連のスワイプ操作を再現する
 */
function swipe(element: HTMLElement, from: Point, to: Point) {
  fireEvent.touchStart(element, { touches: [point(from)] });
  fireEvent.touchMove(element, { touches: [point(to)] });
  fireEvent.touchEnd(element, { changedTouches: [point(to)] });
}

describe("useHorizontalSwipe フックのテスト", () => {
  it("左方向へしきい値以上スワイプすると onSwipeLeft が呼ばれること", () => {
    const onSwipeLeft = vi.fn();
    const onSwipeRight = vi.fn();
    render(<SwipeProbe onSwipeLeft={onSwipeLeft} onSwipeRight={onSwipeRight} />);

    swipe(screen.getByTestId("swipe-area"), { x: 300, y: 400 }, { x: 120, y: 405 });

    expect(onSwipeLeft).toHaveBeenCalledTimes(1);
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it("右方向へしきい値以上スワイプすると onSwipeRight が呼ばれること", () => {
    const onSwipeLeft = vi.fn();
    const onSwipeRight = vi.fn();
    render(<SwipeProbe onSwipeLeft={onSwipeLeft} onSwipeRight={onSwipeRight} />);

    swipe(screen.getByTestId("swipe-area"), { x: 100, y: 400 }, { x: 280, y: 395 });

    expect(onSwipeRight).toHaveBeenCalledTimes(1);
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  it("移動量がしきい値未満の場合はスワイプとして扱われないこと", () => {
    const onSwipeLeft = vi.fn();
    const onSwipeRight = vi.fn();
    render(<SwipeProbe onSwipeLeft={onSwipeLeft} onSwipeRight={onSwipeRight} />);

    swipe(screen.getByTestId("swipe-area"), { x: 300, y: 400 }, { x: 260, y: 400 });

    expect(onSwipeLeft).not.toHaveBeenCalled();
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it("縦方向の移動が支配的な場合（縦スクロール）はスワイプとして扱われないこと", () => {
    const onSwipeLeft = vi.fn();
    const onSwipeRight = vi.fn();
    render(<SwipeProbe onSwipeLeft={onSwipeLeft} onSwipeRight={onSwipeRight} />);

    // 横 100px に対して縦 200px 動いており、縦スクロール操作とみなされる
    swipe(screen.getByTestId("swipe-area"), { x: 300, y: 500 }, { x: 200, y: 300 });

    expect(onSwipeLeft).not.toHaveBeenCalled();
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it("enabled が false の場合はスワイプしてもコールバックが呼ばれないこと", () => {
    const onSwipeLeft = vi.fn();
    const onSwipeRight = vi.fn();
    render(<SwipeProbe onSwipeLeft={onSwipeLeft} onSwipeRight={onSwipeRight} enabled={false} />);

    swipe(screen.getByTestId("swipe-area"), { x: 300, y: 400 }, { x: 100, y: 400 });

    expect(onSwipeLeft).not.toHaveBeenCalled();
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it("2本指操作（ピンチズーム）に移行した場合はスワイプとして扱われないこと", () => {
    const onSwipeLeft = vi.fn();
    render(<SwipeProbe onSwipeLeft={onSwipeLeft} />);

    const area = screen.getByTestId("swipe-area");
    fireEvent.touchStart(area, { touches: [point({ x: 300, y: 400 })] });
    fireEvent.touchMove(area, {
      touches: [point({ x: 250, y: 400 }), point({ x: 350, y: 420 })],
    });
    fireEvent.touchEnd(area, { changedTouches: [point({ x: 100, y: 400 })] });

    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  it("2本指で開始したタッチはスワイプとして扱われないこと", () => {
    const onSwipeLeft = vi.fn();
    render(<SwipeProbe onSwipeLeft={onSwipeLeft} />);

    const area = screen.getByTestId("swipe-area");
    fireEvent.touchStart(area, {
      touches: [point({ x: 300, y: 400 }), point({ x: 320, y: 420 })],
    });
    fireEvent.touchEnd(area, { changedTouches: [point({ x: 100, y: 400 })] });

    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  it("touchcancel で中断された操作はスワイプとして扱われないこと", () => {
    const onSwipeLeft = vi.fn();
    render(<SwipeProbe onSwipeLeft={onSwipeLeft} />);

    const area = screen.getByTestId("swipe-area");
    fireEvent.touchStart(area, { touches: [point({ x: 300, y: 400 })] });
    fireEvent.touchCancel(area);
    fireEvent.touchEnd(area, { changedTouches: [point({ x: 100, y: 400 })] });

    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  it("touchstart なしで touchend のみ発火してもコールバックが呼ばれないこと", () => {
    const onSwipeRight = vi.fn();
    render(<SwipeProbe onSwipeRight={onSwipeRight} />);

    fireEvent.touchEnd(screen.getByTestId("swipe-area"), {
      changedTouches: [point({ x: 300, y: 400 })],
    });

    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it("threshold オプションを指定するとスワイプ判定距離が変更されること", () => {
    const onSwipeLeft = vi.fn();
    render(<SwipeProbe onSwipeLeft={onSwipeLeft} threshold={20} />);

    swipe(screen.getByTestId("swipe-area"), { x: 300, y: 400 }, { x: 270, y: 400 });

    expect(onSwipeLeft).toHaveBeenCalledTimes(1);
  });

  it("連続してスワイプした場合にそれぞれ判定されること", () => {
    const onSwipeLeft = vi.fn();
    const onSwipeRight = vi.fn();
    render(<SwipeProbe onSwipeLeft={onSwipeLeft} onSwipeRight={onSwipeRight} />);

    const area = screen.getByTestId("swipe-area");
    swipe(area, { x: 300, y: 400 }, { x: 100, y: 400 });
    swipe(area, { x: 100, y: 400 }, { x: 300, y: 400 });

    expect(onSwipeLeft).toHaveBeenCalledTimes(1);
    expect(onSwipeRight).toHaveBeenCalledTimes(1);
  });
});
