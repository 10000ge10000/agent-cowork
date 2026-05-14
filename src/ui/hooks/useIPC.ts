import { useCallback, useEffect, useRef, useState } from "react";
import type { ServerEvent, ClientEvent } from "../types";

export function useIPC(onEvent: (event: ServerEvent) => void) {
  const [connected, setConnected] = useState(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(false);
  // 使用 ref 存储回调，避免依赖变化导致 effect 重执行
  const onEventRef = useRef(onEvent);

  // 同步更新 ref 但避免触发 effect 重执行
  useEffect(() => {
    onEventRef.current = onEvent;
  });

  useEffect(() => {
    // Subscribe to server events - 使用 ref 中的回调
    const unsubscribe = window.electron.onServerEvent((event: ServerEvent) => {
      onEventRef.current(event);
    });

    unsubscribeRef.current = unsubscribe;

    // Mark as connected after mounting
    if (!mountedRef.current) {
      mountedRef.current = true;
      // Use setTimeout to defer state update outside render cycle
      setTimeout(() => setConnected(true), 0);
    }

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      mountedRef.current = false;
      setConnected(false);
    };
  }, []); // 空依赖数组 - 只在挂载/卸载时执行

  const sendEvent = useCallback((event: ClientEvent) => {
    window.electron.sendClientEvent(event);
  }, []);

  return { connected, sendEvent };
}
