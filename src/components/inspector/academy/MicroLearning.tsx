// src/components/inspector/academy/MicroLearning.tsx

import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  FlatList,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAcademyData } from '../../../hooks/useAcademyData';
import type { CourseWithProgress } from '../../../types/resources';
import CourseModal from './CourseModal';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH * 0.72;
const CARD_SPACING = 14;

type FilterKey = 'all' | Course['category'];

export default function MicroLearning() {
  const [selectedCourse, setSelectedCourse] = useState<CourseWithProgress | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');

  const {
    courses,
    stats,
    categories,
    continueLearningCourse,
    loading,
    error,
  } = useAcademyData();

  const openCourse = (course: CourseWithProgress) => {
    setSelectedCourse(course);
    setModalVisible(true);
  };

  const closeCourse = () => {
    setModalVisible(false);
    setTimeout(() => setSelectedCourse(null), 300);
  };

  // Continue learning (use the hook's computed value)
  const continueLearnCourse = continueLearningCourse;

  // Filtered courses
  const filteredCourses =
    activeFilter === 'all'
      ? courses
      : courses.filter((c) => c.category === activeFilter);

  // Create filters from categories
  const filters: { key: FilterKey; label: string; icon: string }[] = [
    { key: 'all', label: 'All', icon: 'grid-outline' },
    ...categories
      .filter(cat => cat !== 'All')
      .map((cat) => ({
        key: cat as FilterKey,
        label: cat,
        icon: 'book-outline', // Default icon for categories
      })),
  ];

  return (
    <View style={styles.container}>
      {/* Section Header */}
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleRow}>
          <View style={styles.sectionIconWrap}>
            <Ionicons name="school-outline" size={18} color="#6C5CE7" />
          </View>
          <View>
            <Text style={styles.sectionTitle}>NEXPEC Academy</Text>
            <Text style={styles.sectionSubtitle}>
              Micro-Learning • {stats.totalCourses} Courses Available
            </Text>
          </View>
        </View>
      </View>

      {/* Stats Strip */}
      <View style={styles.statsStrip}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{stats.avgProgress}%</Text>
          <Text style={styles.statLabel}>Avg Progress</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: '#00B894' }]}>
            {stats.completedCount}
          </Text>
          <Text style={styles.statLabel}>Completed</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: '#FDCB6E' }]}>
            {stats.inProgressCount}
          </Text>
          <Text style={styles.statLabel}>In Progress</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: '#FF4C6E' }]}>
            {stats.totalCourses - stats.completedCount - stats.inProgressCount}
          </Text>
          <Text style={styles.statLabel}>Not Started</Text>
        </View>
      </View>

      {/* Continue Learning Card */}
      {continueLearnCourse && (
        <TouchableOpacity
          style={styles.continueCard}
          activeOpacity={0.85}
          onPress={() => openCourse(continueLearnCourse)}
        >
          <View style={styles.continueLeft}>
            <View
              style={[
                styles.continueIconCircle,
                { backgroundColor: 'rgba(253,203,110,0.15)' },
              ]}
            >
              <Ionicons
                name="school-outline"
                size={20}
                color="#FDCB6E"
              />
            </View>
            <View style={styles.continueInfo}>
              <Text style={styles.continueLabel}>Continue Learning</Text>
              <Text style={styles.continueTitle} numberOfLines={1}>
                {continueLearnCourse.title}
              </Text>
              <View style={styles.continueMiniProgress}>
                <View style={styles.continueMiniBar}>
                  <View
                    style={[
                      styles.continueMiniBarFill,
                      {
                        width: `${continueLearnCourse.progress}%`,
                        backgroundColor: '#FDCB6E',
                      },
                    ]}
                  />
                </View>
                <Text
                  style={[
                    styles.continueMiniPercent,
                    { color: '#FDCB6E' },
                  ]}
                >
                  {continueLearnCourse.progress}%
                </Text>
              </View>
            </View>
          </View>
          <View
            style={[
              styles.continueArrow,
              { backgroundColor: 'rgba(253,203,110,0.20)' },
            ]}
          >
            <Ionicons
              name="arrow-forward"
              size={16}
              color="#FDCB6E"
            />
          </View>
        </TouchableOpacity>
      )}

      {/* Filter Row */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {filters.map((f) => {
          const isActive = activeFilter === f.key;
          const catColor = isActive ? '#0984E3' : 'rgba(255,255,255,0.3)';
          return (
            <TouchableOpacity
              key={f.key}
              style={[
                styles.filterChip,
                isActive && {
                  backgroundColor: 'rgba(9,132,227,0.15)',
                  borderColor: 'rgba(9,132,227,0.30)',
                },
              ]}
              onPress={() => setActiveFilter(f.key)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={f.icon as any}
                size={13}
                color={catColor}
              />
              <Text
                style={[
                  styles.filterChipText,
                  isActive && { color: '#0984E3' },
                ]}
              >
                {f.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Course Cards Horizontal Scroll */}
      <FlatList
        horizontal
        data={filteredCourses}
        keyExtractor={(item) => item.id}
        showsHorizontalScrollIndicator={false}
        snapToInterval={CARD_WIDTH + CARD_SPACING}
        decelerationRate="fast"
        contentContainerStyle={styles.carouselContent}
        renderItem={({ item }) => {
          const accentColor = '#6C5CE7'; // Default accent color

          return (
            <TouchableOpacity
              style={styles.courseCard}
              activeOpacity={0.9}
              onPress={() => openCourse(item)}
            >
              {/* Top accent */}
              <View
                style={[styles.cardAccent, { backgroundColor: accentColor }]}
              />

              {/* Card Body */}
              <View style={styles.cardBody}>
                {/* Icon & Difficulty */}
                <View style={styles.cardTopRow}>
                  <View
                    style={[
                      styles.cardIconWrap,
                      { backgroundColor: 'rgba(108,92,231,0.15)' },
                    ]}
                  >
                    <Ionicons
                      name="school-outline"
                      size={22}
                      color="#6C5CE7"
                    />
                  </View>
                  <View
                    style={[
                      styles.difficultyBadge,
                      { backgroundColor: 'rgba(253,203,110,0.15)' },
                    ]}
                  >
                    <Text
                      style={[styles.difficultyText, { color: '#FDCB6E' }]}
                    >
                      {item.level || 'Beginner'}
                    </Text>
                  </View>
                </View>

                {/* Title */}
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={styles.cardSubtitle} numberOfLines={2}>
                  {item.description || 'Course description not available'}
                </Text>

                {/* Instructor & Duration */}
                <View style={styles.cardMetaRow}>
                  <View style={styles.cardMetaItem}>
                    <Ionicons
                      name="person-outline"
                      size={11}
                      color="rgba(255,255,255,0.3)"
                    />
                    <Text style={styles.cardMetaText} numberOfLines={1}>
                      {item.instructor || 'NEXPEC Instructor'}
                    </Text>
                  </View>
                  <View style={styles.cardMetaItem}>
                    <Ionicons
                      name="time-outline"
                      size={11}
                      color="rgba(255,255,255,0.3)"
                    />
                    <Text style={styles.cardMetaText}>{item.duration || 'N/A'}</Text>
                  </View>
                </View>

                {/* Progress */}
                <View style={styles.cardProgress}>
                  <View style={styles.cardProgressBar}>
                    <View
                      style={[
                        styles.cardProgressFill,
                        {
                          width: `${item.progress}%`,
                          backgroundColor: accentColor,
                        },
                      ]}
                    />
                  </View>
                  <View style={styles.cardProgressMeta}>
                    <Text
                      style={[
                        styles.cardProgressText,
                        { color: accentColor },
                      ]}
                    >
                      {item.progress}%
                    </Text>
                    <Text style={styles.cardModulesText}>
                      {item.progress > 0 ? 'In Progress' : 'Not Started'}
                    </Text>
                  </View>
                </View>

                {/* Status Badge */}
                <View
                  style={[
                    styles.statusBadge,
                    item.progress === 100 && styles.statusComplete,
                    item.progress === 0 && styles.statusNew,
                  ]}
                >
                  <Ionicons
                    name={
                      item.progress === 100
                        ? 'checkmark-circle'
                        : item.progress === 0
                        ? 'sparkles'
                        : 'play-circle'
                    }
                    size={12}
                    color={
                      item.progress === 100
                        ? '#00B894'
                        : item.progress === 0
                        ? '#6C5CE7'
                        : accentColor
                    }
                  />
                  <Text
                    style={[
                      styles.statusText,
                      {
                        color:
                          item.progress === 100
                            ? '#00B894'
                            : item.progress === 0
                            ? '#6C5CE7'
                            : accentColor,
                      },
                    ]}
                  >
                    {item.progress === 100
                      ? 'Completed'
                      : item.progress === 0
                      ? 'New Course'
                      : 'In Progress'}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyCarousel}>
            <Ionicons
              name="school-outline"
              size={28}
              color="rgba(255,255,255,0.12)"
            />
            <Text style={styles.emptyText}>No courses in this category</Text>
          </View>
        }
      />

      {/* Course Modal */}
      <CourseModal
        visible={modalVisible}
        course={selectedCourse as any}
        onClose={closeCourse}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 0,
  },
  sectionHeader: {
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 14,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sectionIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(108,92,231,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  sectionSubtitle: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },

  // Stats
  statsStrip: {
    flexDirection: 'row',
    marginHorizontal: 20,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    marginBottom: 14,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  statLabel: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 10,
    fontWeight: '500',
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: '70%',
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignSelf: 'center',
  },

  // Continue Learning
  continueCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 20,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    marginBottom: 16,
  },
  continueLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  continueIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueInfo: {
    flex: 1,
  },
  continueLabel: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  continueTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
  },
  continueMiniProgress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  continueMiniBar: {
    flex: 1,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  continueMiniBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  continueMiniPercent: {
    fontSize: 11,
    fontWeight: '700',
  },
  continueArrow: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },

  // Filters
  filterRow: {
    paddingHorizontal: 20,
    gap: 8,
    paddingBottom: 14,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  filterChipText: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 12,
    fontWeight: '600',
  },

  // Carousel
  carouselContent: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    gap: CARD_SPACING,
  },

  // Course Card
  courseCard: {
    width: CARD_WIDTH,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.04)',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  cardAccent: {
    height: 3,
    width: '100%',
  },
  cardBody: {
    padding: 18,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  cardIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  difficultyBadge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 7,
  },
  difficultyText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.2,
    marginBottom: 4,
  },
  cardSubtitle: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 14,
  },
  cardMetaRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 16,
  },
  cardMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flex: 1,
  },
  cardMetaText: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 11,
    fontWeight: '500',
    flex: 1,
  },
  cardProgress: {
    marginBottom: 14,
  },
  cardProgressBar: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  cardProgressFill: {
    height: '100%',
    borderRadius: 2,
  },
  cardProgressMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  cardProgressText: {
    fontSize: 12,
    fontWeight: '700',
  },
  cardModulesText: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: 11,
    fontWeight: '500',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  statusComplete: {
    backgroundColor: 'rgba(0,184,148,0.1)',
  },
  statusNew: {
    backgroundColor: 'rgba(108,92,231,0.1)',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },

  // Empty
  emptyCarousel: {
    width: SCREEN_WIDTH - 40,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyText: {
    color: 'rgba(255,255,255,0.2)',
    fontSize: 13,
  },
});