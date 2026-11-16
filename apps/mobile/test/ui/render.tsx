import { render } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { Dimensions, StyleSheet, type ViewStyle } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { JsonElement } from 'test-renderer';

// Helpers for component tests: render inside the providers and check the 140 % text rules.

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function Providers({ children }: { children: ReactNode }) {
  return <SafeAreaProvider initialMetrics={METRICS}>{children}</SafeAreaProvider>;
}

/** Sets the phone's text size (1 = default, 1.4 = the largest size the app supports). */
export function setFontScale(fontScale: number) {
  const window = { width: 390, height: 844, scale: 3, fontScale };
  Dimensions.set({ window, screen: window });
}

export function renderUi(element: ReactElement) {
  return render(element, { wrapper: Providers });
}

type Node = JsonElement;

const childrenOf = (node: Node): Node[] =>
  (node.children ?? []).filter((child): child is Node => typeof child !== 'string');

const styleOf = (node: Node): ViewStyle =>
  (StyleSheet.flatten(node.props.style as ViewStyle | ViewStyle[] | undefined) ?? {}) as ViewStyle;

function walk(node: Node | Node[] | null, visit: (node: Node, ancestors: Node[]) => void) {
  const go = (current: Node, ancestors: Node[]) => {
    visit(current, ancestors);
    for (const child of childrenOf(current)) go(child, [...ancestors, current]);
  };
  if (!node) return;
  for (const root of Array.isArray(node) ? node : [node]) go(root, []);
}

/** Inter texts (icons are Text nodes too, with their own font, and do not scale). */
const isAppText = (node: Node) => {
  const font = (
    StyleSheet.flatten(node.props.style as never) as { fontFamily?: unknown } | undefined
  )?.fontFamily;
  return node.type === 'Text' && typeof font === 'string' && font.startsWith('Inter');
};

const hasTextInside = (node: Node): boolean => {
  let found = false;
  walk(node, (inner) => {
    if (isAppText(inner) || inner.type === 'TextInput') found = true;
  });
  return found;
};

const TOUCHABLE_ROLES = new Set(['button', 'checkbox', 'radio', 'tab', 'switch', 'link']);

/** Touch height including the hit slop. */
function touchHeight(node: Node): number {
  const style = styleOf(node);
  const height = Number(style.minHeight ?? style.height ?? 0);
  const slop = node.props.hitSlop as number | { top?: number; bottom?: number } | undefined;
  const extra = typeof slop === 'number' ? slop * 2 : (slop?.top ?? 0) + (slop?.bottom ?? 0);
  return height + extra;
}

/**
 * Rules that keep a screen readable at 140 % (2.4 §3, 3.2 §9.4):
 * - every Inter text scales up to 1.4× and is never cut (no numberOfLines);
 * - a box that holds text never has a fixed height (it uses minHeight and grows);
 * - every touchable is at least 48 high (with its hit slop).
 * Returns the problems found, empty when the tree follows them.
 */
export function largeTextProblems(tree: Node | Node[] | null): string[] {
  const problems: string[] = [];
  walk(tree, (node) => {
    if (isAppText(node)) {
      if (node.props.maxFontSizeMultiplier !== 1.4) {
        problems.push(`text without maxFontSizeMultiplier 1.4: ${textOf(node)}`);
      }
      if (node.props.numberOfLines) problems.push(`text cut with numberOfLines: ${textOf(node)}`);
    }
    if (node.type === 'TextInput' && node.props.maxFontSizeMultiplier !== 1.4) {
      problems.push('text input without maxFontSizeMultiplier 1.4');
    }
    const style = styleOf(node);
    if (node.type !== 'Text' && style.height !== undefined && hasTextInside(node)) {
      problems.push(`fixed height ${String(style.height)} around text: ${textOf(node)}`);
    }
    const role = node.props.accessibilityRole as string | undefined;
    if (
      role &&
      TOUCHABLE_ROLES.has(role) &&
      style.position !== 'absolute' &&
      touchHeight(node) < 48
    ) {
      problems.push(`touch area under 48 (${touchHeight(node)}) for ${role}: ${textOf(node)}`);
    }
  });
  return problems;
}

function textOf(node: Node): string {
  const parts: string[] = [];
  const collect = (current: Node) => {
    for (const child of current.children ?? []) {
      if (typeof child === 'string') parts.push(child);
      else collect(child);
    }
  };
  collect(node);
  return parts.join(' ').slice(0, 60) || String(node.props.accessibilityLabel ?? node.type);
}
