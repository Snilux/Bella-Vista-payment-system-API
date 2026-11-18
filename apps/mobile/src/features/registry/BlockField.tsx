import { useBlocks } from '../../api/useOrganization.js';
import { useAccount } from '../../session/session-store.js';
import { DataRow, Select, SummaryCard } from '../../ui/index.js';

// The block of P-03 and P-05: a block leader registers only in their own block (the API refuses
// another one, OUT_OF_SCOPE), so it is fixed; the secretary chooses an active block.

export function useFixedBlock(): number | null {
  return useAccount()?.blockId ?? null;
}

export function BlockField({
  value,
  onChange,
  error,
}: {
  value: number | null;
  onChange: (blockId: number) => void;
  error?: string | null;
}) {
  const account = useAccount();
  const blocks = useBlocks();
  if (account?.blockId) {
    return (
      <SummaryCard tone="plain">
        <DataRow label="Manzana" value={account.blockCode ?? ''} />
      </SummaryCard>
    );
  }
  return (
    <Select
      label="Manzana"
      required
      options={(blocks.data ?? [])
        .filter((block) => block.active)
        .map((block) => ({ value: block.id, label: block.fullCode }))}
      value={value}
      onChange={onChange}
      placeholder="Elija la manzana"
      error={error ?? null}
    />
  );
}
