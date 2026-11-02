"use client";
export type DemoSnap = { speed: number; paused: boolean; skip: boolean; ready: boolean; err: string };
export const useDemoSwarm = (): DemoSnap | null => null;
export const demoActive = () => false;
export const demoLive = () => false;
export const demoPoll = (ms: number) => ms;
export const demoSwarm = { setSpeed: (_s: number) => {}, togglePause: () => {}, setSkip: (_on: boolean) => {}, reset: () => {} };
