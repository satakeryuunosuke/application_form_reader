/**
 * UI & State Management Framework Wrapper (v2.0)
 * Preact + HTM + Signals (No-Build / Strict CSP Compliant / Auto XSS Protection)
 */

import { h, render, Fragment, Component, createContext, createRef } from '../lib/preact.mjs';
import { useState, useEffect, useRef, useMemo, useCallback, useReducer, useContext, useLayoutEffect } from '../lib/hooks.mjs';
import { signal, computed, effect, batch, untracked, Signal } from '../lib/signals-core.mjs';
import htm from '../lib/htm.mjs';

export const html = htm.bind(h);

/**
 * コンポーネントローカルなSignalを生成するカスタムフック
 */
export function useSignal(initialValue) {
  const sigRef = useRef(null);
  if (!sigRef.current) {
    sigRef.current = signal(initialValue);
  }
  const [, setTick] = useState(0);
  useEffect(() => {
    let mounted = true;
    let isFirst = true;
    const dispose = effect(() => {
      // Signalの値を購読
      void sigRef.current.value;
      if (isFirst) {
        isFirst = false;
        return;
      }
      if (mounted) {
        setTick(t => t + 1);
      }
    });
    return () => {
      mounted = false;
      dispose();
    };
  }, []);
  return sigRef.current;
}

/**
 * 外部Signalを購読してコンポーネントを自動再描画するフック
 */
export function useSubscribeSignal(sig) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!sig || typeof sig.subscribe !== 'function') return;
    let mounted = true;
    let isFirst = true;
    const dispose = effect(() => {
      void sig.value;
      if (isFirst) {
        isFirst = false;
        return;
      }
      if (mounted) {
        setTick(t => t + 1);
      }
    });
    return () => {
      mounted = false;
      dispose();
    };
  }, [sig]);
  return sig ? sig.value : undefined;
}

export {
  h,
  render,
  Fragment,
  Component,
  createContext,
  createRef,
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  useReducer,
  useContext,
  useLayoutEffect,
  signal,
  computed,
  effect,
  batch,
  untracked,
  Signal
};
