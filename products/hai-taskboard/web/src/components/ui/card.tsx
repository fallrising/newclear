import type { HTMLAttributes, PropsWithChildren } from 'react';
import { cx } from '../../lib/utils';

export function Card({
  children,
  className,
  ...props
}: PropsWithChildren<HTMLAttributes<HTMLElement>>) {
  return (
    <section className={cx('card', className)} {...props}>
      {children}
    </section>
  );
}
