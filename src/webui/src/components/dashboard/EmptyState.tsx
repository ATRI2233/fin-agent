interface EmptyStateProps {
  msg: string;
}

export function EmptyState({ msg }: EmptyStateProps) {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: 40,
        color: 'var(--text-tertiary)',
        fontSize: 15,
      }}
    >
      {msg}
    </div>
  );
}
