import { useCallback, useRef } from "react";
import type { TouchEvent as ReactTouchEvent } from "react";

/** 縦操作か横操作かを確定させるまでに必要な移動量 (px) */
const DEFAULT_AXIS_LOCK_THRESHOLD_PX = 10;

/** 速度算出に用いるサンプルの有効期間 (ms) */
const VELOCITY_WINDOW_MS = 100;

/** 速度算出のために保持するサンプル数の上限 */
const MAX_VELOCITY_SAMPLES = 8;

/**
 * 速度算出に必要な最低計測時間 (ms)。おおよそ 1 フレーム分。
 * サンプルが 1 点しかない場合など計測時間が極端に短いと、わずかな移動でも
 * 過大な速度が算出されてしまうため、その場合は速度なしとして扱う。
 */
const MIN_VELOCITY_ELAPSED_MS = 16;

export interface HorizontalDragEndResult {
  /** 開始点からの横移動量 (px)。右方向が正 */
  deltaX: number;
  /** 終了直前の横方向の速度 (px/ms)。右方向が正 */
  velocityX: number;
}

export interface UseHorizontalDragOptions {
  /** 横方向の操作と確定した時点で呼ばれる */
  onDragStart?: () => void;
  /** ドラッグ中、指の移動に応じて呼ばれる */
  onDragMove?: (deltaX: number) => void;
  /** 指を離した時点で呼ばれる */
  onDragEnd?: (result: HorizontalDragEndResult) => void;
  /** 開始済みのドラッグが中断された時点で呼ばれる */
  onDragCancel?: () => void;
  /** 縦横の判定を行う移動量 (px)。既定値は 10 */
  axisLockThreshold?: number;
  /** false の場合はドラッグを検出しない。既定値は true */
  enabled?: boolean;
}

export interface HorizontalDragHandlers {
  onTouchStart: (event: ReactTouchEvent<HTMLElement>) => void;
  onTouchMove: (event: ReactTouchEvent<HTMLElement>) => void;
  onTouchEnd: (event: ReactTouchEvent<HTMLElement>) => void;
  onTouchCancel: () => void;
}

type DragAxis = "unlocked" | "horizontal" | "vertical";

interface VelocitySample {
  x: number;
  time: number;
}

interface DragState {
  startX: number;
  startY: number;
  axis: DragAxis;
  samples: VelocitySample[];
}

function pushSample(state: DragState, x: number): void {
  state.samples.push({ x, time: Date.now() });
  if (state.samples.length > MAX_VELOCITY_SAMPLES) {
    state.samples.shift();
  }
}

/**
 * 直近 VELOCITY_WINDOW_MS 以内のサンプルから横方向の速度 (px/ms) を求める
 */
function computeVelocityX(state: DragState): number {
  const samples = state.samples;
  const last = samples[samples.length - 1];
  if (!last) return 0;

  let oldest = last;
  for (let i = samples.length - 1; i >= 0; i--) {
    if (last.time - samples[i].time > VELOCITY_WINDOW_MS) break;
    oldest = samples[i];
  }

  const elapsed = last.time - oldest.time;
  if (elapsed < MIN_VELOCITY_ELAPSED_MS) return 0;
  return (last.x - oldest.x) / elapsed;
}

/**
 * タッチ操作による横方向のドラッグを追跡するフック。
 *
 * 最初の数 px で縦操作か横操作かを判定し（方向ロック）、横と確定した場合のみ
 * ドラッグとして扱う。`event.preventDefault()` は呼ばないため、縦スクロールや
 * リンクのタップといったブラウザ標準の挙動は維持される。横方向のパンを
 * 抑止したい場合は対象要素へ `touch-action: pan-y` を指定すること。
 */
export function useHorizontalDrag({
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
  axisLockThreshold = DEFAULT_AXIS_LOCK_THRESHOLD_PX,
  enabled = true,
}: UseHorizontalDragOptions): HorizontalDragHandlers {
  const stateRef = useRef<DragState | null>(null);

  /** 進行中の操作を破棄する。ドラッグ開始済みだった場合のみ中断を通知する */
  const abort = useCallback(() => {
    const wasDragging = stateRef.current?.axis === "horizontal";
    stateRef.current = null;
    if (wasDragging) {
      onDragCancel?.();
    }
  }, [onDragCancel]);

  const onTouchStart = useCallback(
    (event: ReactTouchEvent<HTMLElement>) => {
      // 複数指での操作（ピンチズーム等）は対象外とする
      if (!enabled || event.touches.length !== 1) {
        abort();
        return;
      }
      const touch = event.touches[0];
      stateRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        axis: "unlocked",
        samples: [{ x: touch.clientX, time: Date.now() }],
      };
    },
    [enabled, abort],
  );

  const onTouchMove = useCallback(
    (event: ReactTouchEvent<HTMLElement>) => {
      const state = stateRef.current;
      if (!state) return;

      // 途中で複数指の操作へ移行した場合は破棄する
      if (event.touches.length > 1) {
        abort();
        return;
      }

      const touch = event.touches[0];
      if (!touch) return;

      const deltaX = touch.clientX - state.startX;
      const deltaY = touch.clientY - state.startY;

      if (state.axis === "unlocked") {
        if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < axisLockThreshold) return;
        if (Math.abs(deltaX) <= Math.abs(deltaY)) {
          // 縦操作と判定した場合は以降スクロールに専念させる
          state.axis = "vertical";
          return;
        }
        state.axis = "horizontal";
        onDragStart?.();
      }

      if (state.axis !== "horizontal") return;

      pushSample(state, touch.clientX);
      onDragMove?.(deltaX);
    },
    [abort, axisLockThreshold, onDragStart, onDragMove],
  );

  const onTouchEnd = useCallback(
    (event: ReactTouchEvent<HTMLElement>) => {
      const state = stateRef.current;
      stateRef.current = null;
      if (!state || state.axis !== "horizontal") return;

      const touch = event.changedTouches[0];
      if (!touch) {
        onDragCancel?.();
        return;
      }

      pushSample(state, touch.clientX);
      onDragEnd?.({
        deltaX: touch.clientX - state.startX,
        velocityX: computeVelocityX(state),
      });
    },
    [onDragEnd, onDragCancel],
  );

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: abort };
}
