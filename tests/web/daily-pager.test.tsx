// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DailyPager, DailyPagerProps } from "../../src/web/components/DailyPager";

interface Point {
  x: number;
  y: number;
}

function point(p: Point) {
  return { clientX: p.x, clientY: p.y };
}

function renderPager(overrides: Partial<DailyPagerProps> = {}) {
  const onDateChange = vi.fn();
  const props: DailyPagerProps = {
    currentDate: "2026-08-19",
    prevDate: "2026-08-18",
    nextDate: "2026-08-20",
    canGoNext: true,
    onDateChange,
    transitionMs: 0,
    renderPage: (date) => <div data-testid="page-content">{date} のページ</div>,
    ...overrides,
  };
  render(<DailyPager {...props} />);
  return { onDateChange };
}

function getArea() {
  return screen.getByTestId("daily-swipe-area");
}

function getTrack() {
  return screen.getByTestId("daily-pager-track");
}

/** touchstart から touchend までの一連のドラッグを再現する */
function drag(fromX: number, toX: number, y = 400) {
  const area = getArea();
  fireEvent.touchStart(area, { touches: [point({ x: fromX, y })] });
  fireEvent.touchMove(area, { touches: [point({ x: toX, y })] });
  fireEvent.touchEnd(area, { changedTouches: [point({ x: toX, y })] });
}

/** touchend を発火せず、ドラッグ途中の状態で止める */
function dragWithoutRelease(fromX: number, toX: number, y = 400) {
  const area = getArea();
  fireEvent.touchStart(area, { touches: [point({ x: fromX, y })] });
  fireEvent.touchMove(area, { touches: [point({ x: toX, y })] });
}

describe("DailyPager コンポーネントのテスト", () => {
  it("静止時は表示中の日付のページのみが描画されていること", () => {
    renderPager();

    const contents = screen.getAllByTestId("page-content");
    expect(contents).toHaveLength(1);
    expect(contents[0].textContent).toBe("2026-08-19 のページ");
    expect(getTrack().getAttribute("data-pager-phase")).toBe("idle");
  });

  it("ドラッグ中は遷移元と遷移先の両方のページが同時に描画されること", () => {
    renderPager();

    dragWithoutRelease(320, 200);

    const contents = screen.getAllByTestId("page-content").map((el) => el.textContent);
    expect(contents).toEqual(["2026-08-18 のページ", "2026-08-19 のページ", "2026-08-20 のページ"]);
    expect(getTrack().getAttribute("data-pager-phase")).toBe("dragging");
  });

  it("ドラッグ中はページ全体が指の移動量に追従すること", () => {
    renderPager();

    dragWithoutRelease(320, 240);

    // 幅を計測できない環境では 0 として扱われるため、移動量がそのまま現れる
    expect(getTrack().style.transform).toBe("translate3d(-80px, 0, 0)");
  });

  it("指を右から左へ十分に動かすと翌日へ遷移すること", async () => {
    const { onDateChange } = renderPager();

    drag(320, 100);

    await waitFor(() => {
      expect(onDateChange).toHaveBeenCalledWith("2026-08-20");
    });
  });

  it("指を左から右へ十分に動かすと前日へ遷移すること", async () => {
    const { onDateChange } = renderPager();

    drag(100, 320);

    await waitFor(() => {
      expect(onDateChange).toHaveBeenCalledWith("2026-08-18");
    });
  });

  it("移動量がしきい値に満たない場合は元のページへ戻り遷移しないこと", async () => {
    const { onDateChange } = renderPager();

    drag(300, 270);

    await waitFor(() => {
      expect(getTrack().getAttribute("data-pager-phase")).toBe("idle");
    });
    expect(onDateChange).not.toHaveBeenCalled();
  });

  it("素早いフリックであれば移動量が小さくても遷移すること", async () => {
    vi.useFakeTimers();
    try {
      const { onDateChange } = renderPager();

      const area = getArea();
      fireEvent.touchStart(area, { touches: [point({ x: 300, y: 400 })] });
      vi.advanceTimersByTime(20);
      // 20ms で 30px 移動 = 1.5px/ms のフリック（距離はしきい値未満）
      fireEvent.touchMove(area, { touches: [point({ x: 270, y: 400 })] });
      fireEvent.touchEnd(area, { changedTouches: [point({ x: 270, y: 400 })] });

      vi.advanceTimersByTime(10);
      expect(onDateChange).toHaveBeenCalledWith("2026-08-20");
    } finally {
      vi.useRealTimers();
    }
  });

  it("縦方向の操作では遷移せず、隣接ページも描画されないこと", () => {
    const { onDateChange } = renderPager();

    const area = getArea();
    fireEvent.touchStart(area, { touches: [point({ x: 300, y: 600 })] });
    fireEvent.touchMove(area, { touches: [point({ x: 240, y: 300 })] });
    fireEvent.touchEnd(area, { changedTouches: [point({ x: 240, y: 300 })] });

    expect(screen.getAllByTestId("page-content")).toHaveLength(1);
    expect(onDateChange).not.toHaveBeenCalled();
  });

  it("翌日へ進めない場合は翌日方向へドラッグしても遷移しないこと", async () => {
    const { onDateChange } = renderPager({ canGoNext: false });

    drag(320, 100);

    await waitFor(() => {
      expect(getTrack().getAttribute("data-pager-phase")).toBe("idle");
    });
    expect(onDateChange).not.toHaveBeenCalled();
  });

  it("翌日へ進めない場合、翌日方向のドラッグには抵抗がかかること", () => {
    renderPager({ canGoNext: false });

    dragWithoutRelease(300, 200);

    // 移動量 -100px に抵抗係数 0.3 が適用され -30px となる
    expect(getTrack().style.transform).toBe("translate3d(-30px, 0, 0)");
  });

  it("翌日へ進めない場合は翌日のページが描画されないこと", () => {
    renderPager({ canGoNext: false });

    dragWithoutRelease(300, 200);

    const contents = screen.getAllByTestId("page-content").map((el) => el.textContent);
    expect(contents).toEqual(["2026-08-18 のページ", "2026-08-19 のページ"]);
  });

  it("前日方向へは制限なくドラッグでき、抵抗がかからないこと", () => {
    renderPager({ canGoNext: false });

    dragWithoutRelease(100, 200);

    expect(getTrack().style.transform).toBe("translate3d(100px, 0, 0)");
  });

  it("遷移アニメーションの完了を待ってから日付が切り替わること", async () => {
    const { onDateChange } = renderPager({ transitionMs: 200 });

    drag(320, 100);

    // アニメーション中は確定していない
    expect(getTrack().getAttribute("data-pager-phase")).toBe("settling-next");
    expect(onDateChange).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(onDateChange).toHaveBeenCalledWith("2026-08-20");
    });
  });

  it("ドラッグ中に2本指操作へ移行した場合は元のページへ戻ること", async () => {
    const { onDateChange } = renderPager();

    const area = getArea();
    fireEvent.touchStart(area, { touches: [point({ x: 320, y: 400 })] });
    fireEvent.touchMove(area, { touches: [point({ x: 120, y: 400 })] });
    fireEvent.touchMove(area, {
      touches: [point({ x: 110, y: 400 }), point({ x: 200, y: 430 })],
    });

    await waitFor(() => {
      expect(getTrack().getAttribute("data-pager-phase")).toBe("idle");
    });
    expect(onDateChange).not.toHaveBeenCalled();
  });

  it("各ページが独立した縦スクロール領域として描画されること", () => {
    renderPager();

    const pages = screen.getAllByTestId("daily-pager-page");
    expect(pages).toHaveLength(3);
    for (const page of pages) {
      expect(page.className).toContain("overflow-y-auto");
    }
    expect(pages.map((el) => el.getAttribute("data-date"))).toEqual([
      "2026-08-18",
      "2026-08-19",
      "2026-08-20",
    ]);
  });

  it("横方向のブラウザ既定動作を抑止しつつ縦スクロールとピンチズームは維持されること", () => {
    renderPager();

    expect(getArea().style.touchAction).toBe("pan-y pinch-zoom");
  });
});
