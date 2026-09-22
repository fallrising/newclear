import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
import { cx } from '../../lib/utils';

type ButtonProps = PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'default' | 'outline' | 'quiet' | 'danger';
  }
>;

export function Button({
  className,
  variant = 'default',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      className={cx('button', `button-${variant}`, className)}
      type={type}
      {...props}
    />
  );
}
