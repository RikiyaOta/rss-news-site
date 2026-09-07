import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { useHorizontalDrag, HorizontalDragEndResult } from "../hooks/useHorizontalDrag";

/** ページ幅に対して何割ドラッグしたら遷移を確定するか */
const COMMIT_DISTANCE_RATIO = 0.25;

/** 遷移確定に必要な最小移動量 (px)。幅が測れない環境での下限も兼ねる */
const MIN_COMMIT_DISTANCE_PX = 48;

/** フリック（素早い指弾き）と判定する速度 (px/ms) */
const FLICK_VELOCITY_PX_PER_MS = 0.4;

/** フリックとして扱うために最低限必要な移動量 (px) */
const MIN_FLICK_DISTANCE_PX = 24;

/** 進めない方向へドラッグした際に適用する抵抗係数 */
const RUBBER_BAND_FACTOR = 0.3;

/** 遷移アニメーションの長さ (ms) */
const DEFAULT_TRANSITION_MS = 260;

const TRANSITION_EASING = "cubic-bezier(0.22, 0.61, 0.36, 1)";

type SettleTarget = "prev" | "next" | "cancel";

export type PagerPhase =
  | "idle"
  | "dragging"
  | "settling-prev"
  | "settling-next"
  | "settling-cancel";

export interface DailyPagerProps {
  currentDate: string;
  prevDate: string;
  nextDate: string;
  /** 翌日へ進めるかどうか。false の場合は抵抗をかけて跳ね返す */
  canGoNext: boolean;
  onDateChange: (date: string) => void;
  /** 各日付のページ内容。scrollRootRef はそのページのスクロール領域を指す */
  renderPage: (date: string, scrollRootRef: RefObject<HTMLElement | null>) => ReactNode;
  /** 遷移アニメーションの長さ (ms) */
  transitionMs?: number;
  /** false の場合はドラッグ操作を受け付けない。既定値は true */
  enabled?: boolean;
}

interface PagerPageProps {
  date: string;
  /** 中身を描画するか。ドラッグ中のみ隣接ページをマウントする */
  mounted: boolean;
  renderPage: DailyPagerProps["renderPage"];
  scrollPositions: RefObject<Record<string, number>>;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 1 日分のページ。日付ごとに独立した縦スクロール領域を持ち、
 * スクロール位置を日付単位で記憶する。
 */
const PagerPage = memo(function PagerPage({
  date,
  mounted,
  renderPage,
  scrollPositions,
}: PagerPageProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || !mounted) return;

    element.scrollTop = scrollPositions.current[date] ?? 0;

    const handleScroll = () => {
      scrollPositions.current[date] = element.scrollTop;
    };
    element.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      scrollPositions.current[date] = element.scrollTop;
      element.removeEventListener("scroll", handleScroll);
    };
  }, [date, mounted, scrollPositions]);

  return (
    <div
      ref={scrollRef}
      data-testid="daily-pager-page"
      data-date={date}
      aria-hidden={!mounted}
      className="w-full h-full shrink-0 overflow-y-auto overscroll-contain"
    >
      {mounted ? renderPage(date, scrollRef) : null}
    </div>
  );
});

/**
 * 日別記事一覧を横方向のページとして扱い、指の動きに追従する
 * 「ページめくり」で前後の日付へ遷移させるコンポーネント。
 *
 * ページは 前日 | 当日 | 翌日 の順に左から並ぶ。指を左へ動かせばページ全体が
 * 左へ動き、右側にある翌日が現れる（指の動きとページの動きが一致する）。
 */
export function DailyPager({
  currentDate,
  prevDate,
  nextDate,
  canGoNext,
  onDateChange,
  renderPage,
  transitionMs = DEFAULT_TRANSITION_MS,
  enabled = true,
}: DailyPagerProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollPositionsRef = useRef<Record<string, number>>({});

  const [width, setWidth] = useState(0);
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const [settleTarget, setSettleTarget] = useState<SettleTarget | null>(null);

  // ページ幅の計測（遷移量の算出に用いる）
  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const measure = () => setWidth(element.offsetWidth);
    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const clearSettleTimer = useCallback(() => {
    if (settleTimerRef.current !== null) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearSettleTimer, [clearSettleTimer]);

  const settle = useCallback(
    (target: SettleTarget) => {
      clearSettleTimer();
      setDragOffset(null);
      setSettleTarget(target);

      const duration = prefersReducedMotion() ? 0 : transitionMs;
      settleTimerRef.current = setTimeout(() => {
        settleTimerRef.current = null;
        setSettleTarget(null);
        if (target === "next") {
          onDateChange(nextDate);
        } else if (target === "prev") {
          onDateChange(prevDate);
        }
      }, duration);
    },
    [clearSettleTimer, transitionMs, onDateChange, nextDate, prevDate],
  );

  const handleDragStart = useCallback(() => {
    clearSettleTimer();
    setSettleTarget(null);
    setDragOffset(0);
  }, [clearSettleTimer]);

  const handleDragMove = useCallback(
    (deltaX: number) => {
      // 指を左へ動かす (deltaX < 0) = 翌日方向。進めない場合は抵抗をかける
      let offset = deltaX < 0 && !canGoNext ? deltaX * RUBBER_BAND_FACTOR : deltaX;
      if (width > 0) {
        offset = Math.max(-width, Math.min(width, offset));
      }
      setDragOffset(offset);
    },
    [canGoNext, width],
  );

  const handleDragEnd = useCallback(
    ({ deltaX, velocityX }: HorizontalDragEndResult) => {
      const commitDistance = Math.max(width * COMMIT_DISTANCE_RATIO, MIN_COMMIT_DISTANCE_PX);
      const flicked =
        Math.abs(velocityX) >= FLICK_VELOCITY_PX_PER_MS &&
        Math.abs(deltaX) >= MIN_FLICK_DISTANCE_PX;
      const shouldCommit = Math.abs(deltaX) >= commitDistance || flicked;
      const direction = flicked ? Math.sign(velocityX) : Math.sign(deltaX);

      if (shouldCommit && direction < 0 && canGoNext) {
        settle("next");
      } else if (shouldCommit && direction > 0) {
        settle("prev");
      } else {
        settle("cancel");
      }
    },
    [width, canGoNext, settle],
  );

  const handleDragCancel = useCallback(() => settle("cancel"), [settle]);

  const dragHandlers = useHorizontalDrag({
    onDragStart: handleDragStart,
    onDragMove: handleDragMove,
    onDragEnd: handleDragEnd,
    onDragCancel: handleDragCancel,
    enabled,
  });

  const isInteracting = dragOffset !== null || settleTarget !== null;

  const phase: PagerPhase = settleTarget
    ? (`settling-${settleTarget}` as PagerPhase)
    : dragOffset !== null
      ? "dragging"
      : "idle";

  // 静止時は幅の計測結果に依存しないよう % で指定し、初回描画のちらつきを防ぐ
  let transform = "translate3d(-100%, 0, 0)";
  if (settleTarget === "next") {
    transform = `translate3d(${-2 * width}px, 0, 0)`;
  } else if (settleTarget === "prev") {
    transform = "translate3d(0px, 0, 0)";
  } else if (settleTarget === "cancel" || dragOffset !== null) {
    transform = `translate3d(${(dragOffset ?? 0) - width}px, 0, 0)`;
  }

  const trackStyle: CSSProperties = {
    transform,
    transition: settleTarget
      ? `transform ${prefersReducedMotion() ? 0 : transitionMs}ms ${TRANSITION_EASING}`
      : "none",
    willChange: isInteracting ? "transform" : undefined,
  };

  return (
    <div
      ref={viewportRef}
      data-testid="daily-swipe-area"
      className="w-full h-full overflow-hidden"
      // 縦スクロールとピンチズームは維持しつつ、横方向はページめくりに割り当てる
      style={{ touchAction: "pan-y pinch-zoom" }}
      {...dragHandlers}
    >
      <div
        data-testid="daily-pager-track"
        data-pager-phase={phase}
        className="flex w-full h-full"
        style={trackStyle}
      >
        <PagerPage
          key={prevDate}
          date={prevDate}
          mounted={isInteracting}
          renderPage={renderPage}
          scrollPositions={scrollPositionsRef}
        />
        <PagerPage
          key={currentDate}
          date={currentDate}
          mounted
          renderPage={renderPage}
          scrollPositions={scrollPositionsRef}
        />
        <PagerPage
          key={nextDate}
          date={nextDate}
          mounted={isInteracting && canGoNext}
          renderPage={renderPage}
          scrollPositions={scrollPositionsRef}
        />
      </div>
    </div>
  );
}
