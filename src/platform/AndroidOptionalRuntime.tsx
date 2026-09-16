import React, { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from 'react';

import { useAppStore } from '../store/appStore';

const AndroidBeautyExtension = lazy(async () => {
  const module = await import('./AndroidBeautyExtension');
  return { default: module.AndroidBeautyExtension };
});
const AndroidBeautyHistoryControls = lazy(async () => {
  const module = await import('./AndroidBeautyHistoryControls');
  return { default: module.AndroidBeautyHistoryControls };
});
const AndroidBodyBeautyExtension = lazy(async () => {
  const module = await import('./AndroidBodyBeautyExtension');
  return { default: module.AndroidBodyBeautyExtension };
});
const AndroidPlaybackPreferences = lazy(async () => {
  const module = await import('./AndroidPlaybackPreferences');
  return { default: module.AndroidPlaybackPreferences };
});

interface AndroidFeatureBoundaryProps {
  feature: string;
  children: ReactNode;
}

interface AndroidFeatureBoundaryState {
  failed: boolean;
}

class AndroidFeatureBoundary extends Component<AndroidFeatureBoundaryProps, AndroidFeatureBoundaryState> {
  public state: AndroidFeatureBoundaryState = { failed: false };

  public static getDerivedStateFromError(): AndroidFeatureBoundaryState {
    return { failed: true };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    console.warn(
      `[KNOUX] Optional Android feature disabled after runtime failure: ${this.props.feature}`,
      error.name,
      error.message,
      info.componentStack,
    );
  }

  public render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Keep heavyweight workers and document-wide observers out of Android startup.
 * They are loaded only when the user actually enters the feature that needs them.
 */
export const AndroidOptionalRuntime: React.FC = () => {
  const currentView = useAppStore((state) => state.currentView);

  if (currentView === 'image-studio') {
    return (
      <Suspense fallback={null}>
        <AndroidFeatureBoundary feature="beauty-retouch">
          <AndroidBeautyExtension />
          <AndroidBodyBeautyExtension />
          <AndroidBeautyHistoryControls />
        </AndroidFeatureBoundary>
      </Suspense>
    );
  }

  if (currentView === 'player') {
    return (
      <Suspense fallback={null}>
        <AndroidFeatureBoundary feature="playback-preferences">
          <AndroidPlaybackPreferences />
        </AndroidFeatureBoundary>
      </Suspense>
    );
  }

  return null;
};
