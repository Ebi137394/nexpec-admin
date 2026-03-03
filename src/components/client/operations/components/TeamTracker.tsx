// src/components/client/operations/components/TeamTracker.tsx

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Image } from 'react-native';
import { useOperationsData } from '../../hooks/useOperationsData';

interface TeamTrackerProps {
  organizationId: string | null;
  style?: any;
}

interface TeamMember {
  id: string;
  name: string;
  role: string;
  avatar: string;
  status: 'active' | 'idle' | 'offline';
  lastSeen: string;
  projects: number;
  efficiency: number;
}

export function TeamTracker({ organizationId, style }: TeamTrackerProps) {
  const { statusBreakdown } = useOperationsData(organizationId);
  const [sortBy, setSortBy] = useState<'name' | 'efficiency' | 'projects'>('efficiency');
  const [filterBy, setFilterBy] = useState<'all' | 'active' | 'idle' | 'offline'>('all');

  // Mock data for demonstration
  const teamMembers: TeamMember[] = [
    {
      id: '1',
      name: 'Sarah Johnson',
      role: 'Project Manager',
      avatar: 'https://picsum.photos/100/100',
      status: 'active',
      lastSeen: '2 minutes ago',
      projects: 3,
      efficiency: 95,
    },
    {
      id: '2',
      name: 'Mike Chen',
      role: 'Senior Inspector',
      avatar: 'https://picsum.photos/101/101',
      status: 'active',
      lastSeen: '5 minutes ago',
      projects: 5,
      efficiency: 88,
    },
    {
      id: '3',
      name: 'Lisa Rodriguez',
      role: 'Quality Assurance',
      avatar: 'https://picsum.photos/102/102',
      status: 'idle',
      lastSeen: '15 minutes ago',
      projects: 2,
      efficiency: 92,
    },
    {
      id: '4',
      name: 'Tom Wilson',
      role: 'Field Technician',
      avatar: 'https://picsum.photos/103/103',
      status: 'offline',
      lastSeen: '2 hours ago',
      projects: 1,
      efficiency: 78,
    },
  ];

  const filteredAndSortedMembers = teamMembers
    .filter(member => filterBy === 'all' || member.status === filterBy)
    .sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'efficiency':
          return b.efficiency - a.efficiency;
        case 'projects':
          return b.projects - a.projects;
        default:
          return 0;
      }
    });

  const renderItem = ({ item }: { item: TeamMember }) => (
    <View style={styles.memberCard}>
      <View style={styles.memberHeader}>
        <View style={styles.avatarContainer}>
          <Image source={{ uri: item.avatar }} style={styles.avatar} />
          <View style={[styles.statusIndicator, getStatusStyle(item.status)]} />
        </View>
        <View style={styles.memberInfo}>
          <Text style={styles.memberName}>{item.name}</Text>
          <Text style={styles.memberRole}>{item.role}</Text>
        </View>
        <View style={styles.memberStats}>
          <Text style={styles.statLabel}>Efficiency</Text>
          <Text style={styles.statValue}>{item.efficiency}%</Text>
        </View>
      </View>
      
      <View style={styles.memberDetails}>
        <View style={styles.detailItem}>
          <Text style={styles.detailLabel}>Projects</Text>
          <Text style={styles.detailValue}>{item.projects}</Text>
        </View>
        <View style={styles.detailItem}>
          <Text style={styles.detailLabel}>Status</Text>
          <Text style={[styles.detailValue, getStatusTextStyle(item.status)]}>
            {item.status.toUpperCase()}
          </Text>
        </View>
        <View style={styles.detailItem}>
          <Text style={styles.detailLabel}>Last Seen</Text>
          <Text style={styles.detailValue}>{item.lastSeen}</Text>
        </View>
      </View>

      <View style={styles.actionButtons}>
        <TouchableOpacity style={styles.actionButton}>
          <Text style={styles.actionButtonText}>Message</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton}>
          <Text style={styles.actionButtonText}>View</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderFilterButton = (label: string, value: 'all' | 'active' | 'idle' | 'offline') => (
    <TouchableOpacity
      style={[
        styles.filterButton,
        filterBy === value && styles.filterButtonActive,
      ]}
      onPress={() => setFilterBy(value)}
    >
      <Text style={[
        styles.filterText,
        filterBy === value && styles.filterTextActive,
      ]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  const renderSortButton = (label: string, value: 'name' | 'efficiency' | 'projects') => (
    <TouchableOpacity
      style={[
        styles.sortButton,
        sortBy === value && styles.sortButtonActive,
      ]}
      onPress={() => setSortBy(value)}
    >
      <Text style={[
        styles.sortText,
        sortBy === value && styles.sortTextActive,
      ]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  const getTeamStats = () => {
    const totalMembers = teamMembers.length;
    const activeMembers = teamMembers.filter(m => m.status === 'active').length;
    const avgEfficiency = Math.round(
      teamMembers.reduce((sum, m) => sum + m.efficiency, 0) / totalMembers
    );
    const totalProjects = teamMembers.reduce((sum, m) => sum + m.projects, 0);

    return { totalMembers, activeMembers, avgEfficiency, totalProjects };
  };

  const stats = getTeamStats();

  return (
    <View style={[styles.container, style]}>
      <Text style={styles.title}>Team Tracker</Text>
      
      {/* Team Stats */}
      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Total Members</Text>
          <Text style={styles.statValue}>{stats.totalMembers}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Active</Text>
          <Text style={[styles.statValue, styles.activeText]}>{stats.activeMembers}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Avg Efficiency</Text>
          <Text style={styles.statValue}>{stats.avgEfficiency}%</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Total Projects</Text>
          <Text style={styles.statValue}>{stats.totalProjects}</Text>
        </View>
      </View>

      {/* Filters and Sort */}
      <View style={styles.controlsContainer}>
        <View style={styles.filterSection}>
          <Text style={styles.controlLabel}>Filter by Status:</Text>
          <View style={styles.filterRow}>
            {renderFilterButton('All', 'all')}
            {renderFilterButton('Active', 'active')}
            {renderFilterButton('Idle', 'idle')}
            {renderFilterButton('Offline', 'offline')}
          </View>
        </View>

        <View style={styles.sortSection}>
          <Text style={styles.controlLabel}>Sort by:</Text>
          <View style={styles.sortRow}>
            {renderSortButton('Name', 'name')}
            {renderSortButton('Efficiency', 'efficiency')}
            {renderSortButton('Projects', 'projects')}
          </View>
        </View>
      </View>

      {/* Team Members List */}
      <FlatList
        data={filteredAndSortedMembers}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            No team members found
          </Text>
        }
      />
    </View>
  );
}

function getStatusStyle(status: string) {
  switch (status) {
    case 'active':
      return { backgroundColor: '#22C55E' };
    case 'idle':
      return { backgroundColor: '#F59E0B' };
    case 'offline':
      return { backgroundColor: '#6B7280' };
    default:
      return { backgroundColor: '#6B7280' };
  }
}

function getStatusTextStyle(status: string) {
  switch (status) {
    case 'active':
      return { color: '#22C55E' };
    case 'idle':
      return { color: '#F59E0B' };
    case 'offline':
      return { color: '#6B7280' };
    default:
      return { color: '#6B7280' };
  }
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
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  statLabel: {
    fontSize: 10,
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
  },
  activeText: {
    color: '#22C55E',
  },
  controlsContainer: {
    marginBottom: 16,
  },
  filterSection: {
    marginBottom: 12,
  },
  sortSection: {
    marginBottom: 12,
  },
  controlLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
    fontWeight: '600',
  },
  filterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sortRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  filterButton: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: '#f0f0f0',
    marginHorizontal: 2,
    alignItems: 'center',
  },
  filterButtonActive: {
    backgroundColor: '#007AFF',
  },
  filterText: {
    fontSize: 11,
    color: '#666',
    fontWeight: '600',
  },
  filterTextActive: {
    color: '#fff',
  },
  sortButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#f0f0f0',
    marginHorizontal: 2,
  },
  sortButtonActive: {
    backgroundColor: '#007AFF',
  },
  sortText: {
    fontSize: 11,
    color: '#666',
    fontWeight: '600',
  },
  sortTextActive: {
    color: '#fff',
  },
  listContainer: {
    paddingBottom: 20,
  },
  memberCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#eee',
  },
  memberHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  statusIndicator: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#fff',
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },
  memberRole: {
    fontSize: 12,
    color: '#666',
  },
  memberStats: {
    alignItems: 'flex-end',
  },
  statLabel: {
    fontSize: 10,
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
  },
  memberDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  detailItem: {
    alignItems: 'center',
    flex: 1,
  },
  detailLabel: {
    fontSize: 10,
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionButton: {
    flex: 1,
    backgroundColor: '#f8f9fa',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginHorizontal: 4,
    alignItems: 'center',
  },
  actionButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  emptyText: {
    textAlign: 'center',
    color: '#666',
    paddingVertical: 20,
    fontSize: 14,
  },
});