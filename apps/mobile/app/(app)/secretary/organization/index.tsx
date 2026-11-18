// S-06 · Organización
import type { Block } from '@bella-vista/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useBlocks, useRoleAssignments, useSections } from '../../../../src/api/useOrganization.js';
import {
  BlockSheet,
  NewBlockSheet,
  NewSectionSheet,
} from '../../../../src/features/organization/OrganizationSheets.js';
import {
  type BlockView,
  organizationView,
} from '../../../../src/features/organization/organization-view.js';
import { useCan } from '../../../../src/session/permissions.js';
import {
  AppText,
  Button,
  Header,
  ListRow,
  MenuGroup,
  MenuRow,
  Notice,
  ScreenLayout,
  ScreenState,
  StatusTag,
  screenStatusOf,
  spacing,
} from '../../../../src/ui/index.js';

// Sections and blocks with their leader; registering sections and blocks (Figma S-06; 3.2
// §10.7). The API has no /v1/organization: this screen joins GET /v1/sections, GET /v1/blocks
// (all of them, each with its current leader) and the role assignments, whose pending block
// leaders show as "Pendiente" until the president decides. A block opens its data and the
// leader actions; "Cargos y jefes" opens S-07.

type Sheet = 'section' | 'block' | null;

export default function Organization() {
  const sections = useSections();
  const blocks = useBlocks();
  const assignments = useRoleAssignments();
  const canManage = useCan('organization.manage');
  const [sheet, setSheet] = useState<Sheet>(null);
  const [chosen, setChosen] = useState<BlockView | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // The pending leaders are extra information: the screen shows without them if they fail.
  const failed = sections.isError ? sections : blocks.isError ? blocks : null;
  const status = failed
    ? failed === sections
      ? screenStatusOf(sections)
      : screenStatusOf(blocks)
    : sections.isPending || blocks.isPending
      ? 'loading'
      : screenStatusOf(sections, (data) => data.length === 0);
  const view =
    sections.data && blocks.data
      ? organizationView(sections.data, blocks.data, assignments.data ?? [])
      : [];

  const retry = () => {
    void sections.refetch();
    void blocks.refetch();
    void assignments.refetch();
  };
  const goToAssignments = (params: Record<string, string>) => {
    setChosen(null);
    router.push({ pathname: '/secretary/organization/role-assignments/new', params });
  };

  const footer = canManage ? (
    <>
      <Button
        label="Nueva manzana"
        onPress={() => setSheet('block')}
        disabledReason={
          sections.data && !sections.data.some((item) => item.active)
            ? 'Primero registre una sección.'
            : null
        }
      />
      <Button label="Nueva sección" variant="secondary" onPress={() => setSheet('section')} />
    </>
  ) : null;

  return (
    <ScreenLayout withinTabs {...(footer ? { footer } : {})}>
      <Header title="Organización" subtitle="Secciones y manzanas" />

      <MenuGroup>
        <MenuRow
          label="Cargos y jefes"
          icon="people"
          onPress={() => router.push('/secretary/organization/role-assignments')}
        />
      </MenuGroup>

      {done ? <Notice icon="success" title={done} /> : null}

      <ScreenState
        status={status}
        error={failed?.error}
        onRetry={retry}
        empty={{ message: 'Todavía no hay secciones. Registre la primera.', icon: 'organization' }}
      >
        {view.map(({ section, blocks: items }) => (
          <View key={section.id} style={styles.section}>
            <View style={styles.sectionTitle}>
              <AppText variant="heading" style={styles.flex}>
                {`${section.code} · ${section.name}`}
              </AppText>
              {section.active ? null : <StatusTag tone="cancelled" label="Inactiva" />}
            </View>
            {items.length === 0 ? (
              <AppText variant="caption">Esta sección todavía no tiene manzanas.</AppText>
            ) : (
              <MenuGroup>
                {items.map((item) => (
                  <ListRow
                    key={item.block.id}
                    title={item.block.fullCode}
                    subtitle={item.subtitle}
                    {...(item.tag ? { tag: item.tag } : {})}
                    onPress={() => setChosen(item)}
                  />
                ))}
              </MenuGroup>
            )}
          </View>
        ))}
      </ScreenState>

      {sheet === 'section' ? (
        <NewSectionSheet
          onClose={() => setSheet(null)}
          onCreated={(section) => {
            setSheet(null);
            setDone(`Se registró la sección ${section.code} · ${section.name}.`);
          }}
        />
      ) : null}
      {sheet === 'block' && sections.data ? (
        <NewBlockSheet
          sections={sections.data}
          onClose={() => setSheet(null)}
          onCreated={(block) => {
            setSheet(null);
            setDone(`Se registró la manzana ${block.fullCode}.`);
          }}
        />
      ) : null}
      <BlockSheet
        view={chosen}
        onClose={() => setChosen(null)}
        onAssign={(block: Block) =>
          goToAssignments({ role: 'block_leader', blockId: String(block.id) })
        }
        onSubstitute={(block: Block) => {
          setChosen(null);
          router.push({
            pathname: '/secretary/organization/role-assignments/substitution',
            params: { blockId: String(block.id) },
          });
        }}
      />
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  flex: { flexShrink: 1 },
});
