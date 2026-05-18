// src/components/inspector/academy/CourseModal.tsx

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Course, DIFFICULTY_META, CATEGORY_META } from './constants/academyData';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface CourseModalProps {
  visible: boolean;
  course: Course | null;
  onClose: () => void;
}

const MODULE_TYPE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  video: 'play-circle-outline',
  quiz: 'help-circle-outline',
  reading: 'reader-outline',
  practical: 'hammer-outline',
};

const MODULE_TYPE_COLORS: Record<string, string> = {
  video: '#0984E3',
  quiz: '#FDCB6E',
  reading: '#6C5CE7',
  practical: '#00B894',
};

export default function CourseModal({ visible, course, onClose }: CourseModalProps) {
  if (!course) return null;

  const diffMeta = DIFFICULTY_META[course.difficulty];
  const catMeta = CATEGORY_META[course.category];
  const nextModule = course.modules.find((m) => !m.completed && !m.locked);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.modalContainer}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          bounces={true}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Close Handle */}
          <View style={styles.handleRow}>
            <View style={styles.handle} />
          </View>

          {/* Close Button */}
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Ionicons name="close" size={22} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>

          {/* Video Player Placeholder */}
          <View style={[styles.videoPlaceholder, { borderColor: `${course.accentColor}30` }]}>
            <View style={[styles.videoOverlay, { backgroundColor: `${course.accentColor}08` }]}>
              {/* Course Icon */}
              <View style={[styles.videoIconCircle, { backgroundColor: `${course.accentColor}20` }]}>
                <Ionicons
                  name={course.thumbnailIcon as any}
                  size={36}
                  color={course.accentColor}
                />
              </View>

              {/* Play Button */}
              <TouchableOpacity
                style={[styles.playButton, { backgroundColor: course.accentColor }]}
                activeOpacity={0.8}
              >
                <Ionicons name="play" size={28} color="#FFFFFF" />
              </TouchableOpacity>

              {/* Duration Badge */}
              <View style={styles.durationBadge}>
                <Ionicons name="time-outline" size={11} color="rgba(255,255,255,0.7)" />
                <Text style={styles.durationBadgeText}>{course.duration}</Text>
              </View>
            </View>

            {/* Scan Lines Effect */}
            {Array.from({ length: 8 }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.scanLine,
                  { top: `${(i + 1) * 11}%`, opacity: 0.03 },
                ]}
              />
            ))}
          </View>

          {/* Progress Bar */}
          <View style={styles.progressSection}>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${course.progress}%`,
                    backgroundColor: course.accentColor,
                  },
                ]}
              />
            </View>
            <View style={styles.progressMeta}>
              <Text style={[styles.progressPercent, { color: course.accentColor }]}>
                {course.progress}% Complete
              </Text>
              <Text style={styles.progressModules}>
                {course.completedModules}/{course.totalModules} modules
              </Text>
            </View>
          </View>

          {/* Course Title & Meta */}
          <View style={styles.courseInfo}>
            <Text style={styles.courseTitle}>{course.title}</Text>
            <Text style={styles.courseSubtitle}>{course.subtitle}</Text>

            <View style={styles.metaPills}>
              <View style={[styles.metaPill, { backgroundColor: `${catMeta.color}15` }]}>
                <Ionicons name={catMeta.icon as any} size={12} color={catMeta.color} />
                <Text style={[styles.metaPillText, { color: catMeta.color }]}>
                  {catMeta.label}
                </Text>
              </View>
              <View style={[styles.metaPill, { backgroundColor: `${diffMeta.color}15` }]}>
                <Text style={[styles.metaPillText, { color: diffMeta.color }]}>
                  {diffMeta.label}
                </Text>
              </View>
            </View>

            <View style={styles.instructorRow}>
              <View style={styles.instructorAvatar}>
                <Ionicons name="person" size={14} color="rgba(255,255,255,0.4)" />
              </View>
              <Text style={styles.instructorName}>{course.instructor}</Text>
            </View>
          </View>

          {/* Description */}
          <View style={styles.descSection}>
            <Text style={styles.descSectionTitle}>About This Course</Text>
            <Text style={styles.descText}>{course.description}</Text>
          </View>

          {/* Modules List */}
          <View style={styles.modulesSection}>
            <Text style={styles.descSectionTitle}>Course Modules</Text>
            {course.modules.map((mod, idx) => {
              const typeColor = MODULE_TYPE_COLORS[mod.type] || '#0984E3';
              const typeIcon = MODULE_TYPE_ICONS[mod.type] || 'play-circle-outline';
              const isNext = nextModule?.id === mod.id;

              return (
                <View
                  key={mod.id}
                  style={[
                    styles.moduleRow,
                    mod.completed && styles.moduleCompleted,
                    mod.locked && styles.moduleLocked,
                    isNext && { borderColor: `${course.accentColor}40` },
                  ]}
                >
                  {/* Number */}
                  <View
                    style={[
                      styles.moduleNumber,
                      mod.completed && { backgroundColor: `${course.accentColor}20` },
                    ]}
                  >
                    {mod.completed ? (
                      <Ionicons
                        name="checkmark"
                        size={14}
                        color={course.accentColor}
                      />
                    ) : mod.locked ? (
                      <Ionicons
                        name="lock-closed"
                        size={12}
                        color="rgba(255,255,255,0.15)"
                      />
                    ) : (
                      <Text
                        style={[
                          styles.moduleNumberText,
                          isNext && { color: course.accentColor },
                        ]}
                      >
                        {idx + 1}
                      </Text>
                    )}
                  </View>

                  {/* Module Info */}
                  <View style={styles.moduleInfo}>
                    <Text
                      style={[
                        styles.moduleTitle,
                        mod.locked && { opacity: 0.3 },
                      ]}
                    >
                      {mod.title}
                    </Text>
                    <View style={styles.moduleMetaRow}>
                      <Ionicons
                        name={typeIcon as any}
                        size={11}
                        color={mod.locked ? 'rgba(255,255,255,0.1)' : typeColor}
                      />
                      <Text
                        style={[
                          styles.moduleMetaText,
                          mod.locked && { opacity: 0.2 },
                        ]}
                      >
                        {mod.type.charAt(0).toUpperCase() + mod.type.slice(1)} • {mod.duration}
                      </Text>
                    </View>
                  </View>

                  {/* Next Badge */}
                  {isNext && (
                    <View style={[styles.nextBadge, { backgroundColor: `${course.accentColor}20` }]}>
                      <Text style={[styles.nextBadgeText, { color: course.accentColor }]}>
                        NEXT
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          {/* Tags */}
          <View style={styles.tagsSection}>
            <View style={styles.tagRow}>
              {course.tags.map((tag, idx) => (
                <View key={idx} style={styles.tag}>
                  <Text style={styles.tagText}>#{tag}</Text>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>

        {/* Bottom CTA */}
        <View style={styles.bottomCTA}>
          <TouchableOpacity
            style={[styles.ctaButton, { backgroundColor: course.accentColor }]}
            activeOpacity={0.85}
          >
            <Ionicons
              name={
                course.progress === 100
                  ? 'refresh-outline'
                  : course.progress === 0
                  ? 'play'
                  : 'arrow-forward'
              }
              size={20}
              color="#FFFFFF"
            />
            <Text style={styles.ctaText}>
              {course.progress === 100
                ? 'Review Course'
                : course.progress === 0
                ? 'Start Learning'
                : 'Continue Learning'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: '#020617',
  },
  scrollContent: {
    paddingBottom: 100,
  },
  handleRow: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 4,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  closeBtn: {
    position: 'absolute',
    top: 16,
    right: 20,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Video Placeholder
  videoPlaceholder: {
    height: 210,
    marginHorizontal: 20,
    marginTop: 16,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.03)',
    overflow: 'hidden',
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  videoOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  playButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  durationBadge: {
    position: 'absolute',
    bottom: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  durationBadgeText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    fontWeight: '600',
  },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#FFFFFF',
  },

  // Progress
  progressSection: {
    marginHorizontal: 20,
    marginTop: 18,
  },
  progressBar: {
    height: 5,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  progressPercent: {
    fontSize: 13,
    fontWeight: '700',
  },
  progressModules: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 12,
    fontWeight: '500',
  },

  // Course Info
  courseInfo: {
    paddingHorizontal: 20,
    marginTop: 20,
  },
  courseTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  courseSubtitle: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 14,
    marginTop: 4,
    lineHeight: 20,
  },
  metaPills: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  metaPillText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  instructorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
  },
  instructorAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  instructorName: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: '500',
  },

  // Description
  descSection: {
    paddingHorizontal: 20,
    marginTop: 24,
  },
  descSectionTitle: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },
  descText: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 13.5,
    lineHeight: 21,
  },

  // Modules
  modulesSection: {
    paddingHorizontal: 20,
    marginTop: 28,
  },
  moduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    marginBottom: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
    gap: 12,
  },
  moduleCompleted: {
    opacity: 0.6,
  },
  moduleLocked: {
    opacity: 0.4,
  },
  moduleNumber: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moduleNumberText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 13,
    fontWeight: '700',
  },
  moduleInfo: {
    flex: 1,
  },
  moduleTitle: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '600',
  },
  moduleMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 3,
  },
  moduleMetaText: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 11,
    fontWeight: '500',
  },
  nextBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  nextBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },

  // Tags
  tagsSection: {
    paddingHorizontal: 20,
    marginTop: 20,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tag: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  tagText: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: 11,
    fontWeight: '500',
  },

  // Bottom CTA
  bottomCTA: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 34,
    backgroundColor: 'rgba(2,6,23,0.95)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  ctaText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});