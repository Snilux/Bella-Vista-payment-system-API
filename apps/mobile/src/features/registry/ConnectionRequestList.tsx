import type { ConnectionRequest, ConnectionRequestStatus } from '@bella-vista/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { connectionRequestPages } from '../../api/useConnectionRequests.js';
import { useCan } from '../../session/permissions.js';
import {
  Button,
  Chip,
  Header,
  PaginatedList,
  RecordCard,
  ScreenLayout,
  spacing,
} from '../../ui/index.js';
import { REQUEST_FILTERS, requestStatusView } from './registry-view.js';

// The connection requests of S-02 (secretary: a chip per status, "Por resolver" first) and J-06
// (block leader: every request of their block, newest first). The API filters by block. A
// request still waiting for the meeting opens S-03 for whoever resolves; any other opens its page
// (P-06), where it is installed or cancelled.

export type ConnectionRequestListProps = {
  title: string;
  subtitle?: string;
  /** S-02: the status chips; J-06 shows every status. */
  withFilters: boolean;
  withinTabs?: boolean;
  onBack?: () => void;
};

export function ConnectionRequestList({
  title,
  subtitle,
  withFilters,
  withinTabs = false,
  onBack,
}: ConnectionRequestListProps) {
  const [status, setStatus] = useState<ConnectionRequestStatus>('requested');
  const canResolve = useCan('connectionRequests.resolve');
  const canRequest = useCan('connectionRequests.manage');
  const pages = connectionRequestPages(withFilters ? status : null);

  const open = (request: ConnectionRequest) =>
    request.status === 'requested' && canResolve
      ? router.push({
          pathname: '/secretary/connection-requests/[id]/resolve',
          params: { id: String(request.id) },
        })
      : router.push({
          pathname: '/common/connection-requests/[id]/activate',
          params: { id: String(request.id) },
        });

  const chosen = REQUEST_FILTERS.find((item) => item.value === status);
  return (
    <ScreenLayout
      withinTabs={withinTabs}
      scroll={false}
      {...(canRequest
        ? {
            footer: (
              <Button
                label="Nueva solicitud"
                onPress={() => router.push('/common/registry/new-connection-request')}
              />
            ),
          }
        : {})}
    >
      <PaginatedList
        // A new status is a new list (its own cache and pages).
        key={pages.queryKey.join('/')}
        queryKey={pages.queryKey}
        fetchPage={pages.fetchPage}
        keyExtractor={(request) => String(request.id)}
        renderItem={(request) => {
          const view = requestStatusView(request);
          return (
            <View style={styles.item}>
              <RecordCard
                title={`${request.folio} · ${request.applicant.fullName}`}
                details={[`${request.blockCode} · ${request.address}`]}
                summary={view.text}
                {...(view.tag ? { tag: view.tag } : {})}
                onPress={() => open(request)}
              />
            </View>
          );
        }}
        empty={{
          message: withFilters
            ? `No hay solicitudes en «${chosen?.label ?? ''}».`
            : 'Todavía no hay solicitudes de toma en su manzana.',
          icon: 'connection',
          ...(canRequest
            ? {
                action: {
                  label: 'Nueva solicitud',
                  onPress: () => router.push('/common/registry/new-connection-request'),
                },
              }
            : {}),
        }}
        header={
          <View style={styles.header}>
            <Header
              title={title}
              {...(subtitle ? { subtitle } : {})}
              {...(onBack ? { onBack } : {})}
            />
            {withFilters ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chips}
              >
                {REQUEST_FILTERS.map((item) => (
                  <Chip
                    key={item.value}
                    label={item.label}
                    selected={status === item.value}
                    onPress={() => setStatus(item.value)}
                  />
                ))}
              </ScrollView>
            ) : null}
          </View>
        }
      />
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.md, paddingBottom: spacing.md },
  chips: { gap: spacing.sm },
  item: { paddingBottom: spacing.md },
});
