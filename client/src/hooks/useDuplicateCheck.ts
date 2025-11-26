import { useEffect, useState } from 'react';
import type { CheckDuplicatesResponse } from '@shared/schema';
import { apiRequest } from '@/lib/queryClient';

// Flexible PreparedRecord type that accepts optional source
interface PreparedRecordInput {
  ecli: string;
  title: string;
  court: string;
  decisionDate: string;
  legalArea: string[];
  procedureType: string;
  sourceUrl: string;
  inhoudsindicatie: string;
  source?: 'web_search' | 'api_search';
  ai_title?: string;
  ai_inhoudsindicatie?: string;
  ai_feiten?: string;
  ai_geschil?: string;
  ai_beslissing?: string;
  ai_motivering?: string;
}

export interface RecordWithDuplicateStatus extends PreparedRecordInput {
  isDuplicate?: boolean;
  uploadedAt?: string;
}

export function useDuplicateCheck(records: PreparedRecordInput[]) {
  const [recordsWithStatus, setRecordsWithStatus] = useState<RecordWithDuplicateStatus[]>(records);
  const [isChecking, setIsChecking] = useState(false);
  const [duplicateCount, setDuplicateCount] = useState(0);

  useEffect(() => {
    async function checkDuplicates() {
      if (records.length === 0) {
        setRecordsWithStatus([]);
        setDuplicateCount(0);
        return;
      }

      setIsChecking(true);

      try {
        // Group records by namespace (derived from source field)
        const namespaceGroups: Record<string, PreparedRecordInput[]> = {};
        
        for (const record of records) {
          // Default to ECLI_NL namespace if source is undefined
          const namespace = record.source === 'web_search' ? 'WEB_ECLI' : 'ECLI_NL';
          if (!namespaceGroups[namespace]) {
            namespaceGroups[namespace] = [];
          }
          namespaceGroups[namespace].push(record);
        }

        // Check duplicates for each namespace separately
        const allStatuses = new Map<string, { isDuplicate: boolean; uploadedAt?: string }>();
        
        for (const [namespace, groupRecords] of Object.entries(namespaceGroups)) {
          const eclis = groupRecords.map(r => r.ecli);
          
          // Split into chunks of 200 (API limit)
          const chunks = [];
          for (let i = 0; i < eclis.length; i += 200) {
            chunks.push(eclis.slice(i, i + 200));
          }
          
          for (const chunk of chunks) {
            const response = await apiRequest(
              'POST',
              '/api/processed-eclis/check',
              { namespace, eclis: chunk }
            );
            
            const data: CheckDuplicatesResponse = await response.json();
            
            // Map results to ECLI → status
            for (const status of data.statuses) {
              allStatuses.set(status.ecli, {
                isDuplicate: status.isProcessed,
                uploadedAt: status.uploadedAt,
              });
            }
          }
        }

        // Decorate records with duplicate status
        const decorated = records.map(record => {
          const status = allStatuses.get(record.ecli);
          return {
            ...record,
            isDuplicate: status?.isDuplicate ?? false,
            uploadedAt: status?.uploadedAt,
          };
        });

        setRecordsWithStatus(decorated);
        setDuplicateCount(decorated.filter(r => r.isDuplicate).length);
      } catch (error) {
        console.error('Error checking duplicates:', error);
        // On error, return records without duplicate status
        setRecordsWithStatus(records);
        setDuplicateCount(0);
      } finally {
        setIsChecking(false);
      }
    }

    checkDuplicates();
  }, [records]);

  return {
    records: recordsWithStatus,
    isChecking,
    duplicateCount,
    newCount: records.length - duplicateCount,
  };
}
