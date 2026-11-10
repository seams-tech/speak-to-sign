// The steps of one dialog, in place of a dialog on top of a dialog. When `view` changes, the old
// step fades out, then the parts of the new step fade in one after another. The dialog itself
// (Modal) animates to the new size, so it reads as one window that changes. With reduced
// motion the steps only fade.

import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from 'react';

/** How long the old step takes to fade out (the CSS `.morph-out`). */
const OUT_MS = 120;

interface ViewProps {
  name: string;
  /**
   * Stay mounted (hidden) while another step shows, so the step keeps its state: for example a
   * market strip that waits for the sign-in to place a bet.
   */
  keep?: boolean;
  children: ReactNode;
}

/** One step of a Morph. Morph renders it; alone it renders nothing. */
export function MorphView(_props: ViewProps): null {
  return null;
}

/**
 * Shows the step named `view`. The children are MorphView elements, one for each step that the
 * dialog can show now; plain children are one step named `view`. `flex`: each step holds a whole
 * dialog (head, body, foot), so it keeps the dialog's column layout and its scrolling body.
 */
export function Morph({ view, flex = false, children }: { view: string; flex?: boolean; children: ReactNode }) {
  const views = new Map<string, ViewProps>();
  Children.forEach(children, (child) => {
    if (isValidElement<ViewProps>(child) && child.type === MorphView) views.set(child.props.name, child.props);
  });
  if (views.size === 0) views.set(view, { name: view, children });

  // The last content of each step, so a step that the parent no longer renders can fade out.
  const last = useRef(new Map<string, ViewProps>());
  useEffect(() => {
    for (const [name, props] of views) last.current.set(name, props);
  });

  const [shown, setShown] = useState(view);
  const [leaving, setLeaving] = useState(false);
  // The step whose parts fade in. None when the dialog opens: it has its own animation.
  const [entered, setEntered] = useState<string | null>(null);

  useEffect(() => {
    if (view === shown) {
      setLeaving(false);
      return;
    }
    const swap = () => {
      setLeaving(false);
      setEntered(view);
      setShown(view);
    };
    setLeaving(true);
    const timer = window.setTimeout(swap, OUT_MS);
    return () => window.clearTimeout(timer);
  }, [view, shown]);

  // On screen: the shown step; hidden: the steps that keep their state.
  const names = [shown, ...[...views.values()].filter((props) => props.keep && props.name !== shown).map((props) => props.name)];
  return (
    <>
      {names.map((name) => {
        const props = views.get(name) ?? last.current.get(name);
        if (!props) return null;
        const visible = name === shown;
        const classes = [
          'morph-view',
          flex ? 'morph-flex' : '',
          visible && leaving ? 'morph-out' : '',
          visible && entered === name ? 'morph-in' : '',
        ];
        return (
          <div key={name} className={classes.filter(Boolean).join(' ')} hidden={!visible}>
            {props.children}
          </div>
        );
      })}
    </>
  );
}
