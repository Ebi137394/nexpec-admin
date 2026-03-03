import React from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/providers/ThemeProvider';
import { getColors } from '@/src/constants/theme';

export default function TermsScreen() {
  const router = useRouter();
  const { isDarkMode } = useTheme();
  const colors = getColors(isDarkMode);

  const currentDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)' }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Terms & Privacy Policy</Text>
        <View style={{ width: 40 }} />
      </View>
      
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Last Updated */}
        <View style={[styles.lastUpdatedContainer, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)' }]}>
          <Ionicons name="time-outline" size={16} color={colors.textMuted} />
          <Text style={[styles.lastUpdatedText, { color: colors.textMuted }]}>
            Last Updated: {currentDate}
          </Text>
        </View>

        {/* Introduction */}
        <View style={styles.section}>
          <Text style={[styles.sectionHeader, { color: colors.text }]}>1. Introduction</Text>
          <Text style={[styles.sectionText, { color: colors.textSecondary }]}>
            Welcome to NEXPEC. These Terms of Service ("Terms") govern your access to and use of our platform, services, and applications. By accessing or using NEXPEC, you agree to be bound by these Terms and our Privacy Policy.
          </Text>
          <Text style={[styles.sectionText, { color: colors.textSecondary }]}>
            NEXPEC provides a platform connecting inspection professionals with clients seeking inspection services. Our services include job listings, contract management, communication tools, and payment processing.
          </Text>
        </View>

        {/* Data Usage */}
        <View style={styles.section}>
          <Text style={[styles.sectionHeader, { color: colors.text }]}>2. Data Usage</Text>
          <Text style={[styles.sectionText, { color: colors.textSecondary }]}>
            We are committed to protecting your privacy and being transparent about how we use your data. This section outlines our data collection, usage, and protection practices.
          </Text>
          <Text style={[styles.subsectionTitle, { color: colors.text }]}>2.1 Information We Collect</Text>
          <Text style={[styles.sectionText, { color: colors.textSecondary }]}>
            We collect information that you provide directly to us, including but not limited to: name, email address, phone number, professional credentials, work history, payment information, inspection reports, and any content you submit through our platform.
          </Text>
          <Text style={[styles.subsectionTitle, { color: colors.text }]}>2.2 How We Use Your Data</Text>
          <Text style={[styles.sectionText, { color: colors.textSecondary }]}>
            We use the information we collect to provide, maintain, and improve our services, process transactions, facilitate communication between users, verify your identity and credentials, send important updates, and comply with legal obligations. We do not sell your personal information to third parties.
          </Text>
          <Text style={[styles.subsectionTitle, { color: colors.text }]}>2.3 Data Sharing and Disclosure</Text>
          <Text style={[styles.sectionText, { color: colors.textSecondary }]}>
            We may share your information with service providers who assist us in operating our platform, processing payments, or providing customer support. We may also disclose information when required by law or to protect the rights and safety of our users.
          </Text>
          <Text style={[styles.subsectionTitle, { color: colors.text }]}>2.4 Data Security</Text>
          <Text style={[styles.sectionText, { color: colors.textSecondary }]}>
            We implement industry-standard security measures including encryption, secure servers, and access controls to protect your personal information. However, no method of transmission over the internet or electronic storage is 100% secure, and we cannot guarantee absolute security.
          </Text>
        </View>

        {/* User Rights */}
        <View style={styles.section}>
          <Text style={[styles.sectionHeader, { color: colors.text }]}>3. User Rights</Text>
          <Text style={[styles.sectionText, { color: colors.textSecondary }]}>
            You have certain rights regarding your personal information. This section outlines your rights and how to exercise them.
          </Text>
          <Text style={[styles.subsectionTitle, { color: colors.text }]}>3.1 Access and Portability</Text>
          <Text style={[styles.sectionText, { color: colors.textSecondary }]}>
            You have the right to access your personal information and request a copy of your data in a portable format. You can access most of your information directly through your account settings.
          </Text>
          <Text style={[styles.subsectionTitle, { color: colors.text }]}>3.2 Correction and Updates</Text>
          <Text style={[styles.sectionText, { color: colors.textSecondary }]}>
            You have the right to correct inaccurate or incomplete information. You can update your profile, contact information, and credentials at any time through your account settings.
          </Text>
          <Text style={[styles.subsectionTitle, { color: colors.text }]}>3.3 Deletion Rights</Text>
          <Text style={[styles.sectionText, { color: colors.textSecondary }]}>
            You have the right to request deletion of your personal information, subject to certain legal and contractual obligations. You can delete your account at any time through your account settings, which will initiate the deletion process.
          </Text>
          <Text style={[styles.subsectionTitle, { color: colors.text }]}>3.4 Opt-Out Rights</Text>
          <Text style={[styles.sectionText, { color: colors.textSecondary }]}>
            You have the right to opt out of certain data processing activities, including marketing communications and non-essential data collection. You can manage your preferences in your account settings or by contacting us directly.
          </Text>
          <Text style={[styles.subsectionTitle, { color: colors.text }]}>3.5 Exercising Your Rights</Text>
          <Text style={[styles.sectionText, { color: colors.textSecondary }]}>
            To exercise any of these rights, please contact us at support@nexpec.com. We will respond to your request within 30 days. We may need to verify your identity before processing certain requests.
          </Text>
        </View>

        {/* User Responsibilities */}
        <View style={styles.section}>
          <Text style={[styles.sectionHeader, { color: colors.text }]}>4. User Responsibilities</Text>
          <Text style={[styles.sectionText, { color: colors.textSecondary }]}>
            As a user of NEXPEC, you are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account.
          </Text>
          <Text style={[styles.subsectionTitle, { color: colors.text }]}>4.1 Account Security</Text>
          <Text style={[styles.sectionText, { color: colors.textSecondary }]}>
            You must immediately notify us of any unauthorized use of your account or any other breach of security. We are not liable for any loss or damage arising from your failure to comply with this requirement.
          </Text>
          <Text style={[styles.subsectionTitle, { color: colors.text }]}>4.2 Acceptable Use</Text>
          <Text style={[styles.sectionText, { color: colors.textSecondary }]}>
            You agree not to use our services for any unlawful purpose or in any way that could damage, disable, or impair our platform. You must provide accurate information and maintain the accuracy of your profile and credentials.
          </Text>
          <Text style={[styles.subsectionTitle, { color: colors.text }]}>4.3 Professional Conduct</Text>
          <Text style={[styles.sectionText, { color: colors.textSecondary }]}>
            Inspection professionals must maintain valid certifications, provide accurate inspection reports, and conduct themselves in a professional manner. Clients must provide accurate job requirements and timely payments.
          </Text>
        </View>

        {/* Payment Terms */}
        <View style={styles.section}>
          <Text style={[styles.sectionHeader, { color: colors.text }]}>5. Payment Terms</Text>
          <Text style={[styles.sectionText, { color: colors.textSecondary }]}>
            All payments are processed securely through our payment partners. Service fees may apply to transactions. Payment disputes must be reported within 30 days of the transaction date.
          </Text>
          <Text style={[styles.sectionText, { color: colors.textSecondary }]}>
            Refunds are subject to our refund policy and may be granted on a case-by-case basis. We reserve the right to withhold payments in cases of suspected fraud or violation of these Terms.
          </Text>
        </View>

        {/* Intellectual Property */}
        <View style={styles.section}>
          <Text style={[styles.sectionHeader, { color: colors.text }]}>6. Intellectual Property</Text>
          <Text style={[styles.sectionText, { color: colors.textSecondary }]}>
            All content on NEXPEC, including but not limited to text, graphics, logos, and software, is the property of NEXPEC or its licensors and is protected by copyright and other intellectual property laws.
          </Text>
          <Text style={[styles.sectionText, { color: colors.textSecondary }]}>
            You retain ownership of any content you submit, but grant NEXPEC a license to use, display, and distribute such content for the purpose of providing our services.
          </Text>
        </View>

        {/* Limitation of Liability */}
        <View style={styles.section}>
          <Text style={[styles.sectionHeader, { color: colors.text }]}>7. Limitation of Liability</Text>
          <Text style={[styles.sectionText, { color: colors.textSecondary }]}>
            NEXPEC acts as a platform connecting users and does not guarantee the quality, safety, or legality of services provided by users. We are not liable for any disputes, damages, or losses arising from transactions between users.
          </Text>
          <Text style={[styles.sectionText, { color: colors.textSecondary }]}>
            To the maximum extent permitted by law, NEXPEC's total liability for any claims arising from or related to our services shall not exceed the amount you paid us in the 12 months preceding the claim.
          </Text>
        </View>

        {/* Changes to Terms */}
        <View style={styles.section}>
          <Text style={[styles.sectionHeader, { color: colors.text }]}>8. Changes to Terms</Text>
          <Text style={[styles.sectionText, { color: colors.textSecondary }]}>
            We reserve the right to modify these Terms at any time. We will notify users of material changes via email or through our platform. Your continued use of NEXPEC after such modifications constitutes acceptance of the updated Terms.
          </Text>
        </View>

        {/* Contact Information */}
        <View style={styles.section}>
          <Text style={[styles.sectionHeader, { color: colors.text }]}>9. Contact Information</Text>
          <Text style={[styles.sectionText, { color: colors.textSecondary }]}>
            If you have any questions about these Terms or our Privacy Policy, please contact us at:
          </Text>
          <Text style={[styles.contactText, { color: colors.primary }]}>
            support@nexpec.com
          </Text>
        </View>

        {/* Bottom Spacing */}
        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
  },
  lastUpdatedContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 8,
    marginBottom: 24,
  },
  lastUpdatedText: {
    fontSize: 13,
    fontWeight: '500',
  },
  section: {
    marginBottom: 28,
  },
  sectionHeader: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
    letterSpacing: 0.3,
  },
  subsectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  sectionText: {
    fontSize: 15,
    lineHeight: 24,
    marginBottom: 12,
  },
  contactText: {
    fontSize: 15,
    fontWeight: '600',
    marginTop: 8,
  },
  bottomSpacer: {
    height: 40,
  },
});
