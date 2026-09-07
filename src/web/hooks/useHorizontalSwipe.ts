import { useCallback, useRef } from "react";
import type { TouchEvent as ReactTouchEvent } from "react";

/** スワイプとみなす最小の横移動量 (px) */
const DEFAULT_THRESHOLD_PX = 60;

/**
 * 横移動が縦移動を上回っていると判定するための比率。
 * |dx| >= |dy| * DEFAULT_DIRECTION_RATIO を満たす場合のみ横スワイプとして扱い、
 * 記事一覧の縦スクロール操作を誤検知しないようにする。
 */
const DEFAULT_DIRECTION_RATIO = 1.5;

export interface UseHorizontalSwipeOptions {
  /** 左方向（指を左へ動かす）へスワイプしたときのコールバック */
  onSwipeLeft?: () => void;
  /** 右方向（指を右へ動かす）へスワイプしたときのコールバック */
  onSwipeRight?: () => void;
  /** スワイプとみなす最小の横移動量 (px)。既定値は 60 */
  threshold?: number;
  /** 横移動が縦移動を上回っていると判定する比率。既定値は 1.5 */
  directionRatio?: number;
  /** false の場合はスワイプ判定を行わない。既定値は true */
  enabled?: boolean;
}

export interface HorizontalSwipeHandlers {
  onTouchStart: (event: ReactTouchEvent<HTMLElement>) => void;
  onTouchMove: (event: ReactTouchEvent<HTMLElement>) => void;
  onTouchEnd: (event: ReactTouchEvent<HTMLElement>) => void;
  onTouchCancel: () => void;
}

interface SwipeOrigin {
  x: number;
  y: number;
}

/**
 * タッチ操作による横スワイプを検出し、要素へ展開できるハンドラ群を返すフック。
 *
 * `event.preventDefault()` は呼ばないため、縦スクロールやリンクのタップなど
 * ブラウザ標準の挙動はそのまま維持される。
 */
export function useHorizontalSwipe({
  onSwipeLeft,
  onSwipeRight,
  threshold = DEFAULT_THRESHOLD_PX,
  directionRatio = DEFAULT_DIRECTION_RATIO,
  enabled = true,
}: UseHorizontalSwipeOptions): HorizontalSwipeHandlers {
  const originRef = useRef<SwipeOrigin | null>(null);

  const reset = useCallback(() => {
    originRef.current = null;
  }, []);

  const onTouchStart = useCallback(
    (event: ReactTouchEvent<HTMLElement>) => {
      // 複数指での操作（ピンチズーム等）はスワイプ対象外とする
      if (!enabled || event.touches.length !== 1) {
        originRef.current = null;
        return;
      }
      const touch = event.touches[0];
      originRef.current = { x: touch.clientX, y: touch.clientY };
    },
    [enabled],
  );

  const onTouchMove = useCallback((event: ReactTouchEvent<HTMLElement>) => {
    // 途中で複数指の操作へ移行した場合はスワイプ判定を破棄する
    if (event.touches.length > 1) {
      originRef.current = null;
    }
  }, []);

  const onTouchEnd = useCallback(
    (event: ReactTouchEvent<HTMLElement>) => {
      const origin = originRef.current;
      originRef.current = null;

      if (!enabled || !origin) return;

      const touch = event.changedTouches[0];
      if (!touch) return;

      const deltaX = touch.clientX - origin.x;
      const deltaY = touch.clientY - origin.y;
      const absX = Math.abs(deltaX);

      if (absX < threshold) return;
      if (absX < Math.abs(deltaY) * directionRatio) return;

      if (deltaX < 0) {
        onSwipeLeft?.();
      } else {
        onSwipeRight?.();
      }
    },
    [enabled, threshold, directionRatio, onSwipeLeft, onSwipeRight],
  );

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: reset };
}
