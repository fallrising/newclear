type HeaderProps = {
  title: string;
  description?: string;
  actions?: React.ReactNode;
};

export function Header({ title, description, actions }: HeaderProps) {
  return (
    <header className="flex items-center justify-between border-b border-border px-8 py-5">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
