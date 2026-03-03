// src/components/client/operations/components/AssetVault.tsx

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Image, Modal } from 'react-native';
import { useSpendingDashboard } from '../../hooks/useSpendingDashboard';

interface AssetVaultProps {
  projectId: string | null;
  organizationId: string | null;
  style?: any;
}

interface AssetItem {
  id: string;
  name: string;
  type: 'image' | 'video' | 'document';
  url: string;
  timestamp: string;
  category: string;
}

export function AssetVault({ projectId, organizationId, style }: AssetVaultProps) {
  const { totalBudget, totalSpent, pendingPayments } = useSpendingDashboard(projectId, organizationId);
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAsset, setSelectedAsset] = useState<AssetItem | null>(null);
  const [filter, setFilter] = useState<'all' | 'images' | 'videos' | 'documents'>('all');

  useEffect(() => {
    // Mock data for demonstration
    const mockAssets: AssetItem[] = [
      {
        id: '1',
        name: 'Site Inspection 1',
        type: 'image',
        url: 'https://picsum.photos/400/300',
        timestamp: '2024-01-15T10:30:00Z',
        category: 'Inspection',
      },
      {
        id: '2',
        name: 'Progress Video',
        type: 'video',
        url: 'https://picsum.photos/400/300',
        timestamp: '2024-01-16T14:20:00Z',
        category: 'Progress',
      },
      {
        id: '3',
        name: 'Blueprint PDF',
        type: 'document',
        url: 'https://picsum.photos/400/300',
        timestamp: '2024-01-17T09:15:00Z',
        category: 'Documentation',
      },
    ];
    
    setAssets(mockAssets);
    setLoading(false);
  }, []);

  const filteredAssets = assets.filter(asset => {
    if (filter === 'all') return true;
    if (filter === 'images') return asset.type === 'image';
    if (filter === 'videos') return asset.type === 'video';
    if (filter === 'documents') return asset.type === 'document';
    return false;
  });

  const renderItem = ({ item }: { item: AssetItem }) => (
    <TouchableOpacity
      style={styles.assetCard}
      onPress={() => setSelectedAsset(item)}
    >
      <View style={styles.assetHeader}>
        <Text style={styles.assetName}>{item.name}</Text>
        <Text style={styles.assetCategory}>{item.category}</Text>
      </View>
      <View style={styles.assetPreview}>
        {item.type === 'image' && (
          <Image source={{ uri: item.url }} style={styles.assetImage} />
        )}
        {item.type === 'video' && (
          <View style={styles.videoPlaceholder}>
            <Text style={styles.videoIcon}>▶️</Text>
            <Text style={styles.videoLabel}>Video</Text>
          </View>
        )}
        {item.type === 'document' && (
          <View style={styles.documentPlaceholder}>
            <Text style={styles.documentIcon}>📄</Text>
            <Text style={styles.documentLabel}>PDF</Text>
          </View>
        )}
      </View>
      <View style={styles.assetFooter}>
        <Text style={styles.assetTimestamp}>
          {new Date(item.timestamp).toLocaleDateString()}
        </Text>
        <Text style={styles.assetType}>{item.type.toUpperCase()}</Text>
      </View>
    </TouchableOpacity>
  );

  const renderFilterButton = (label: string, value: 'all' | 'images' | 'videos' | 'documents') => (
    <TouchableOpacity
      style={[
        styles.filterButton,
        filter === value && styles.filterButtonActive,
      ]}
      onPress={() => setFilter(value)}
    >
      <Text style={[
        styles.filterText,
        filter === value && styles.filterTextActive,
      ]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, style]}>
      <Text style={styles.title}>Asset Vault</Text>
      
      {/* Budget Summary */}
      <View style={styles.budgetSummary}>
        <View style={styles.budgetItem}>
          <Text style={styles.budgetLabel}>Budget</Text>
          <Text style={styles.budgetValue}>${totalBudget.toLocaleString()}</Text>
        </View>
        <View style={styles.budgetItem}>
          <Text style={styles.budgetLabel}>Spent</Text>
          <Text style={[styles.budgetValue, styles.spentValue]}>
            ${totalSpent.toLocaleString()}
          </Text>
        </View>
        <View style={styles.budgetItem}>
          <Text style={styles.budgetLabel}>Pending</Text>
          <Text style={[styles.budgetValue, styles.pendingValue]}>
            ${pendingPayments.toLocaleString()}
          </Text>
        </View>
      </View>

      {/* Filter Buttons */}
      <View style={styles.filterContainer}>
        {renderFilterButton('All', 'all')}
        {renderFilterButton('Images', 'images')}
        {renderFilterButton('Videos', 'videos')}
        {renderFilterButton('Documents', 'documents')}
      </View>

      {/* Asset Grid */}
      <FlatList
        data={filteredAssets}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.listContainer}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {loading ? 'Loading assets...' : 'No assets found'}
          </Text>
        }
      />

      {/* Asset Detail Modal */}
      <Modal
        visible={selectedAsset !== null}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setSelectedAsset(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {selectedAsset && (
              <>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>{selectedAsset.name}</Text>
                  <TouchableOpacity
                    style={styles.closeButton}
                    onPress={() => setSelectedAsset(null)}
                  >
                    <Text style={styles.closeText}>×</Text>
                  </TouchableOpacity>
                </View>
                
                <View style={styles.modalBody}>
                  {selectedAsset.type === 'image' && (
                    <Image
                      source={{ uri: selectedAsset.url }}
                      style={styles.modalImage}
                      resizeMode="contain"
                    />
                  )}
                  {selectedAsset.type === 'video' && (
                    <View style={styles.modalVideo}>
                      <Text style={styles.modalVideoText}>Video Preview</Text>
                      <Text style={styles.modalVideoIcon}>▶️</Text>
                    </View>
                  )}
                  {selectedAsset.type === 'document' && (
                    <View style={styles.modalDocument}>
                      <Text style={styles.modalDocumentText}>Document Preview</Text>
                      <Text style={styles.modalDocumentIcon}>📄</Text>
                    </View>
                  )}
                </View>

                <View style={styles.modalFooter}>
                  <Text style={styles.modalDetail}>
                    Category: {selectedAsset.category}
                  </Text>
                  <Text style={styles.modalDetail}>
                    Date: {new Date(selectedAsset.timestamp).toLocaleString()}
                  </Text>
                  <Text style={styles.modalDetail}>
                    Type: {selectedAsset.type.toUpperCase()}
                  </Text>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    margin: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginBottom: 16,
  },
  budgetSummary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    padding: 12,
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
  },
  budgetItem: {
    alignItems: 'center',
    flex: 1,
  },
  budgetLabel: {
    fontSize: 10,
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  budgetValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
  },
  spentValue: {
    color: '#FF3B30',
  },
  pendingValue: {
    color: '#FF9500',
  },
  filterContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  filterButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
    marginHorizontal: 4,
    alignItems: 'center',
  },
  filterButtonActive: {
    backgroundColor: '#007AFF',
  },
  filterText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
  },
  filterTextActive: {
    color: '#fff',
  },
  listContainer: {
    paddingBottom: 20,
  },
  row: {
    justifyContent: 'space-between',
  },
  assetCard: {
    width: '48%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#eee',
  },
  assetHeader: {
    marginBottom: 8,
  },
  assetName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },
  assetCategory: {
    fontSize: 10,
    color: '#666',
    textTransform: 'uppercase',
  },
  assetPreview: {
    height: 80,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#f8f9fa',
    marginBottom: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  assetImage: {
    width: '100%',
    height: '100%',
  },
  videoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoIcon: {
    fontSize: 24,
  },
  videoLabel: {
    fontSize: 10,
    color: '#666',
    marginTop: 4,
  },
  documentPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  documentIcon: {
    fontSize: 24,
  },
  documentLabel: {
    fontSize: 10,
    color: '#666',
    marginTop: 4,
  },
  assetFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  assetTimestamp: {
    fontSize: 10,
    color: '#666',
  },
  assetType: {
    fontSize: 10,
    color: '#007AFF',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  emptyText: {
    textAlign: 'center',
    color: '#666',
    paddingVertical: 20,
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    width: '100%',
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: 24,
    color: '#666',
    lineHeight: 24,
  },
  modalBody: {
    padding: 16,
    alignItems: 'center',
  },
  modalImage: {
    width: '100%',
    height: 300,
    borderRadius: 8,
  },
  modalVideo: {
    width: '100%',
    height: 200,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalVideoText: {
    fontSize: 16,
    color: '#666',
    marginBottom: 8,
  },
  modalVideoIcon: {
    fontSize: 48,
  },
  modalDocument: {
    width: '100%',
    height: 200,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalDocumentText: {
    fontSize: 16,
    color: '#666',
    marginBottom: 8,
  },
  modalDocumentIcon: {
    fontSize: 48,
  },
  modalFooter: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  modalDetail: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
});