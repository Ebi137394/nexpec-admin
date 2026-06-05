import { useState, useCallback, useMemo } from 'react';
import {
  EquipmentItem,
  EquipmentCategory,
  CalibrationStatus,
} from '../types/inspectorTools.types';
import {
  getCalibrationStatus,
  getDaysUntilExpiry,
  isEquipmentUsable,
} from '../utils/calibrationEngine';

// ─── Mock Data ───
const MOCK_EQUIPMENT: EquipmentItem[] = [
  {
    id: 'eq_001',
    name: 'Ultrasonic Thickness Gauge',
    model: 'Olympus 38DL Plus',
    serialNumber: 'SN-38DL-045892',
    category: 'ultrasonic',
    icon: '📡',
    calibrationDate: '2024-11-15',
    calibrationDueDays: 365,
    calibrationCertId: 'CAL-2024-0891',
    isActive: true,
    lastUsedInReport: 'RPT-2025-0042',
  },
  {
    id: 'eq_002',
    name: 'Magnetic Particle Yoke',
    model: 'Parker DA-400',
    serialNumber: 'SN-DA400-11234',
    category: 'mpi',
    icon: '🧲',
    calibrationDate: '2025-01-10',
    calibrationDueDays: 180,
    calibrationCertId: 'CAL-2025-0123',
    isActive: true,
  },
  {
    id: 'eq_003',
    name: 'Pit Depth Gauge',
    model: 'Elcometer 126',
    serialNumber: 'SN-E126-88741',
    category: 'measurement',
    icon: '📏',
    calibrationDate: '2024-06-01',
    calibrationDueDays: 365,
    isActive: true,
    notes: 'Primary pit gauge for floor inspections',
  },
  {
    id: 'eq_004',
    name: 'Holiday Detector',
    model: 'Elcometer 236',
    serialNumber: 'SN-E236-55123',
    category: 'holiday_detector',
    icon: '⚡',
    calibrationDate: '2025-04-20',
    calibrationDueDays: 180,
    calibrationCertId: 'CAL-2025-0456',
    isActive: true,
  },
  {
    id: 'eq_005',
    name: 'Hardness Tester',
    model: 'Proceq Equotip 550',
    serialNumber: 'SN-EQ550-33219',
    category: 'hardness_tester',
    icon: '💎',
    calibrationDate: '2024-03-10',
    calibrationDueDays: 365,
    isActive: true,
    notes: 'Leeb rebound method to requires test block verification before each use',
  },
  {
    id: 'eq_006',
    name: 'DFT Gauge',
    model: 'PosiTector 6000',
    serialNumber: 'SN-PT6K-78432',
    category: 'measurement',
    icon: '🎨',
    calibrationDate: '2025-05-01',
    calibrationDueDays: 365,
    calibrationCertId: 'CAL-2025-0789',
    isActive: true,
  },
];

interface UseEquipmentStoreReturn {
  equipment: EquipmentItem[];
  filteredEquipment: EquipmentItem[];
  activeFilter: CalibrationStatus | 'all';
  setActiveFilter: (filter: CalibrationStatus | 'all') => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  toggleEquipmentActive: (id: string) => void;
  getItemStatus: (item: EquipmentItem) => CalibrationStatus;
  getItemDaysLeft: (item: EquipmentItem) => number;
  isItemUsable: (item: EquipmentItem) => boolean;
  stats: {
    total: number;
    valid: number;
    expiringSoon: number;
    expired: number;
  };
}

export function useEquipmentStore(): UseEquipmentStoreReturn {
  const [equipment, setEquipment] = useState<EquipmentItem[]>(MOCK_EQUIPMENT);
  const [activeFilter, setActiveFilter] = useState<CalibrationStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const stats = useMemo(() => {
    let valid = 0;
    let expiringSoon = 0;
    let expired = 0;
    equipment.forEach((item) => {
      const status = getCalibrationStatus(item);
      if (status === 'valid') valid++;
      else if (status === 'expiring_soon') expiringSoon++;
      else expired++;
    });
    return { total: equipment.length, valid, expiringSoon, expired };
  }, [equipment]);

  const filteredEquipment = useMemo(() => {
    let filtered = equipment;

    // Apply status filter
    if (activeFilter !== 'all') {
      filtered = filtered.filter(
        (item) => getCalibrationStatus(item) === activeFilter
      );
    }

    // Apply search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          item.model.toLowerCase().includes(q) ||
          item.serialNumber.toLowerCase().includes(q)
      );
    }

    return filtered;
  }, [equipment, activeFilter, searchQuery]);

  const toggleEquipmentActive = useCallback((id: string) => {
    setEquipment((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        // Cannot activate expired equipment
        if (!item.isActive && getCalibrationStatus(item) === 'expired') {
          return item; // block activation
        }
        return { ...item, isActive: !item.isActive };
      })
    );
  }, []);

  return {
    equipment,
    filteredEquipment,
    activeFilter,
    setActiveFilter,
    searchQuery,
    setSearchQuery,
    toggleEquipmentActive,
    getItemStatus: getCalibrationStatus,
    getItemDaysLeft: getDaysUntilExpiry,
    isItemUsable: isEquipmentUsable,
    stats,
  };
}