// ════════════════════════════════════════════════════════════════════════════
//  src/components/legal/MarkdownView.tsx
//
//  Pure-RN minimal markdown renderer. Sized exactly for the NEXPEC legal
//  stack — handles only the markdown subset our documents use:
//      # H1 / ## H2 / ### H3 / #### H4
//      paragraphs, blank-line separated
//      > blockquote (used for the "Plain-English summary" lead)
//      - / * bulleted lists, 1. numbered lists
//      **bold** *italic* `code`
//      --- horizontal rule
//
//  Tables and images are NOT supported — by design. The single doc that
//  contains a table (ADDENDUM-FRAMEWORK-001 §6) was authored to render
//  acceptably as paragraph-style text.
// ════════════════════════════════════════════════════════════════════════════

import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

type ThemePalette = {
  text: string;
  textSecondary: string;
  background: string;
  card: string;
  cardBorder?: string;
  primary: string;
  accent?: string;
};

type BlockKind =
  | { kind: 'h'; level: 1 | 2 | 3 | 4; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'hr' };

interface Props {
  markdown: string;
  colors: ThemePalette;
}

export const MarkdownView: React.FC<Props> = ({ markdown, colors }) => {
  const blocks = useMemo(() => parseBlocks(markdown), [markdown]);
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View>
      {blocks.map((block, idx) => renderBlock(block, idx, styles, colors))}
    </View>
  );
};

// ─────────── Parser ───────────

function parseBlocks(md: string): BlockKind[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: BlockKind[] = [];
  let i = 0;
  let paraBuf: string[] = [];

  const flushPara = () => {
    if (paraBuf.length > 0) {
      blocks.push({ kind: 'p', text: paraBuf.join(' ').trim() });
      paraBuf = [];
    }
  };

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();

    // Blank line → paragraph boundary.
    if (line.trim() === '') {
      flushPara();
      i++;
      continue;
    }

    // Horizontal rule.
    if (/^\s*---+\s*$/.test(line)) {
      flushPara();
      blocks.push({ kind: 'hr' });
      i++;
      continue;
    }

    // Headers H1–H4.
    const headerMatch = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    if (headerMatch) {
      flushPara();
      const level = headerMatch[1].length as 1 | 2 | 3 | 4;
      blocks.push({ kind: 'h', level, text: headerMatch[2] });
      i++;
      continue;
    }

    // Blockquote — possibly multi-line.
    if (/^\s*>\s?/.test(line)) {
      flushPara();
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, '').trim());
        i++;
      }
      blocks.push({ kind: 'quote', text: buf.join(' ').trim() });
      continue;
    }

    // Bulleted list (- or *).
    if (/^\s*[-*]\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, '').trim());
        i++;
      }
      blocks.push({ kind: 'list', ordered: false, items });
      continue;
    }

    // Numbered list (1. 2. etc.).
    if (/^\s*\d+\.\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, '').trim());
        i++;
      }
      blocks.push({ kind: 'list', ordered: true, items });
      continue;
    }

    // Default: paragraph line, accumulate.
    paraBuf.push(line.trim());
    i++;
  }
  flushPara();
  return blocks;
}

// ─────────── Inline renderer ───────────

type InlineToken =
  | { t: 'text'; v: string }
  | { t: 'bold'; v: string }
  | { t: 'italic'; v: string }
  | { t: 'code'; v: string };

function tokenizeInline(s: string): InlineToken[] {
  // Order matters: scan for **bold** first, then `code`, then *italic*, then plain.
  const tokens: InlineToken[] = [];
  // Combined regex matches one of the four token forms in priority order.
  const re = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\*([^*]+)\*)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m.index > lastIndex) {
      tokens.push({ t: 'text', v: s.slice(lastIndex, m.index) });
    }
    if (m[2] !== undefined) tokens.push({ t: 'bold', v: m[2] });
    else if (m[4] !== undefined) tokens.push({ t: 'code', v: m[4] });
    else if (m[6] !== undefined) tokens.push({ t: 'italic', v: m[6] });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < s.length) tokens.push({ t: 'text', v: s.slice(lastIndex) });
  return tokens;
}

const InlineText: React.FC<{
  text: string;
  baseStyle: TextStyle;
  styles: ReturnType<typeof makeStyles>;
}> = ({ text, baseStyle, styles }) => {
  const tokens = tokenizeInline(text);
  return (
    <Text style={baseStyle}>
      {tokens.map((tok, i) => {
        switch (tok.t) {
          case 'bold':
            return (
              <Text key={i} style={styles.bold}>
                {tok.v}
              </Text>
            );
          case 'italic':
            return (
              <Text key={i} style={styles.italic}>
                {tok.v}
              </Text>
            );
          case 'code':
            return (
              <Text key={i} style={styles.code}>
                {tok.v}
              </Text>
            );
          case 'text':
          default:
            return <Text key={i}>{tok.v}</Text>;
        }
      })}
    </Text>
  );
};

// ─────────── Block renderer ───────────

function renderBlock(
  block: BlockKind,
  idx: number,
  styles: ReturnType<typeof makeStyles>,
  colors: ThemePalette,
): React.ReactNode {
  switch (block.kind) {
    case 'h': {
      const styleByLevel: Record<1 | 2 | 3 | 4, TextStyle> = {
        1: styles.h1,
        2: styles.h2,
        3: styles.h3,
        4: styles.h4,
      };
      return (
        <View key={idx} style={styles.headerWrap}>
          <InlineText
            text={block.text}
            baseStyle={styleByLevel[block.level]}
            styles={styles}
          />
        </View>
      );
    }
    case 'p':
      return (
        <View key={idx} style={styles.paraWrap}>
          <InlineText text={block.text} baseStyle={styles.p} styles={styles} />
        </View>
      );
    case 'quote':
      return (
        <View
          key={idx}
          style={[
            styles.quoteWrap,
            {
              borderLeftColor: colors.primary,
              backgroundColor: colors.primary + '10',
            },
          ]}
        >
          <InlineText
            text={block.text}
            baseStyle={styles.quote}
            styles={styles}
          />
        </View>
      );
    case 'list':
      return (
        <View key={idx} style={styles.listWrap}>
          {block.items.map((item, i) => (
            <View key={i} style={styles.listItem}>
              <Text style={styles.bullet}>
                {block.ordered ? `${i + 1}.` : '•'}
              </Text>
              <View style={styles.listItemBody}>
                <InlineText
                  text={item}
                  baseStyle={styles.p}
                  styles={styles}
                />
              </View>
            </View>
          ))}
        </View>
      );
    case 'hr':
      return (
        <View
          key={idx}
          style={[
            styles.hr,
            { backgroundColor: (colors.cardBorder ?? colors.textSecondary) + '40' },
          ]}
        />
      );
    default:
      return null;
  }
}

// ─────────── Styles ───────────

function makeStyles(colors: ThemePalette) {
  return StyleSheet.create({
    headerWrap: { marginTop: 18, marginBottom: 6 } as ViewStyle,
    paraWrap: { marginBottom: 10 } as ViewStyle,
    listWrap: { marginBottom: 12, marginTop: 4 } as ViewStyle,
    listItem: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginBottom: 6,
    } as ViewStyle,
    listItemBody: { flex: 1 } as ViewStyle,
    bullet: {
      width: 22,
      color: colors.primary,
      fontSize: 15,
      fontWeight: '700',
      lineHeight: 22,
    } as TextStyle,
    quoteWrap: {
      borderLeftWidth: 3,
      paddingVertical: 12,
      paddingHorizontal: 14,
      marginVertical: 14,
      borderRadius: 6,
    } as ViewStyle,
    quote: {
      fontSize: 14.5,
      lineHeight: 22,
      color: colors.text,
      fontStyle: 'italic',
    } as TextStyle,
    h1: {
      fontSize: 24,
      fontWeight: '800',
      color: colors.text,
      letterSpacing: -0.4,
      lineHeight: 30,
    } as TextStyle,
    h2: {
      fontSize: 19,
      fontWeight: '700',
      color: colors.text,
      letterSpacing: -0.2,
      lineHeight: 26,
    } as TextStyle,
    h3: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
      lineHeight: 22,
    } as TextStyle,
    h4: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textSecondary,
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      lineHeight: 20,
    } as TextStyle,
    p: {
      fontSize: 15,
      lineHeight: 23,
      color: colors.text,
    } as TextStyle,
    bold: { fontWeight: '700', color: colors.text } as TextStyle,
    italic: { fontStyle: 'italic' } as TextStyle,
    code: {
      fontFamily: 'Courier',
      fontSize: 13.5,
      color: colors.primary,
      backgroundColor: colors.primary + '14',
    } as TextStyle,
    hr: {
      height: 1,
      marginVertical: 16,
    } as ViewStyle,
  });
}

export default MarkdownView;
