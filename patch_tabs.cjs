const fs = require('fs');
let code = fs.readFileSync('src/components/app/PersistentTabs.tsx', 'utf8');

// Add memo to imports if not there
if (!code.includes('memo,')) {
  code = code.replace(/import {/, 'import { memo,');
}

// Add MemoizedTab component before PersistentTabs
const memoizedComponent = `
const MemoizedTab = memo(({ Component }: { Component: React.ComponentType }) => {
  return (
    <ErrorBoundary>
      <Suspense fallback={null}>
        <Component />
      </Suspense>
    </ErrorBoundary>
  );
});

export function PersistentTabs`;

code = code.replace(/export function PersistentTabs/, memoizedComponent);

// Replace the render
const oldRender = `<ErrorBoundary>
              <Suspense fallback={null}>
                <Component />
              </Suspense>
            </ErrorBoundary>`;
            
const newRender = `<MemoizedTab Component={Component} />`;

code = code.replace(oldRender, newRender);

fs.writeFileSync('src/components/app/PersistentTabs.tsx', code);
