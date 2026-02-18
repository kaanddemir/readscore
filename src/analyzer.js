/**
 * ReadScore - Readability Analyzer
 * Analyzes text for readability metrics using transparent, explainable rules.
 * No AI, no external APIs - all processing happens locally.
 * 
 * Optimized for accuracy with research-backed thresholds and algorithms.
 */
'use strict';

const ReadScoreAnalyzer = {
  // Reading speed - using consistent 250 WPM (standard adult average)
  // Research shows adults read 200-300 WPM, 250 is a good middle ground
  READING_SPEEDS: {
    EASY: 275,    // Slightly faster for easy content
    MEDIUM: 250,  // Standard adult reading speed
    HARD: 200     // Slower for complex content (not as slow as 150)
  },

  // Thresholds for readability classification
  THRESHOLDS: {
    SENTENCE_LENGTH: {
      EASY: 14,    // Up to 14 words = easy sentence
      MEDIUM: 22,  // 15-22 words = medium
      HARD: 25     // 25+ words = hard to follow
    },
    COMPLEX_RATIO: {
      EASY: 0.08,  // Up to 8% complex words
      HARD: 0.15   // 15%+ complex words
    },
    PARAGRAPH_DENSITY: {
      DENSE: 100,       // Words per paragraph threshold
      MIN_SENTENCES: 4  // Minimum sentences to be considered dense
    },
    CLAUSE_DENSITY: {
      COMPLEX: 4  // 4+ clauses = complex sentence
    }
  },

  // Centralized labels and color classes for consistency
  LABELS: {
    // Sentence quality labels
    SENTENCE: {
      TOO_SHORT: { label: 'Too Short', colorClass: 'quality-warning' },
      SHORT: { label: 'Short', colorClass: 'quality-good' },
      OPTIMAL: { label: 'Optimal', colorClass: 'quality-optimal' },
      LONG: { label: 'Long', colorClass: 'quality-warning' },
      TOO_LONG: { label: 'Too Long', colorClass: 'quality-bad' }
    },
    // Word count categories
    WORD_COUNT: {
      QUICK: { label: 'Quick Read', colorClass: 'length-quick' },
      SHORT: { label: 'Short', colorClass: 'length-short' },
      MEDIUM: { label: 'Medium', colorClass: 'length-medium' },
      LONG: { label: 'Long Read', colorClass: 'length-long' },
      DEEP: { label: 'In-Depth', colorClass: 'length-deep' }
    }
  },

  // Syllable count overrides for common exceptions
  SYLLABLE_OVERRIDES: {
    // 2 syllables (often miscounted as 3)
    'business': 2, 'every': 2, 'different': 2, 'interest': 2,
    'evening': 2, 'family': 2, 'several': 2, 'general': 2,
    'natural': 2, 'actually': 3, 'chocolate': 2, 'favorite': 2,
    'vegetable': 3, 'comfortable': 3, 'reasonable': 3,
    // 3 syllables (often miscounted)
    'important': 3, 'beautiful': 3, 'possible': 3, 'terrible': 3,
    'difficult': 3, 'wonderful': 3, 'carefully': 3, 'probably': 3,
    'especially': 4, 'interesting': 4, 'unfortunately': 5
  },

  // Common "easy" polysyllabic words to exclude from complex words
  COMMON_POLYSYLLABIC: new Set([
    'everyone', 'everything', 'everywhere', 'however', 'another',
    'together', 'already', 'although', 'without', 'because',
    'before', 'between', 'during', 'often', 'sometimes',
    'usually', 'always', 'really', 'actually', 'probably',
    'certainly', 'definitely', 'absolutely', 'completely', 'exactly',
    'important', 'different', 'beautiful', 'wonderful', 'interesting',
    'government', 'understand', 'information', 'technology', 'education',
    'community', 'experience', 'opportunity', 'relationship', 'remember',
    'something', 'anything', 'nothing', 'everything', 'somebody'
  ]),

  // Common abbreviations that shouldn't end sentences
  ABBREVIATIONS: new Set([
    'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'vs', 'etc', 'inc', 'ltd', 'corp',
    'eg', 'ie', 'al', 'vol', 'no', 'pp', 'ed', 'est', 'approx', 'dept', 'govt',
    'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
    'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun',
    'st', 'nd', 'rd', 'th', 'ave', 'blvd', 'ct', 'ln', 'ft', 'lb', 'oz',
    'u', 's', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
    'n', 'o', 'p', 'q', 'r', 't', 'v', 'w', 'x', 'y', 'z',
    'ph', 'ba', 'ma', 'bs', 'ms', 'mba', 'ceo', 'cto', 'cfo'
  ]),

  /**
   * Count syllables in a word using improved vowel-pattern algorithm
   * @param {string} word - The word to analyze
   * @returns {number} - Number of syllables
   */
  countSyllables(word) {
    if (!word) return 0;

    word = word.toLowerCase().trim();
    if (word.length <= 2) return 1;

    // Check override dictionary first
    if (this.SYLLABLE_OVERRIDES[word]) {
      return this.SYLLABLE_OVERRIDES[word];
    }

    // Handle compound words (split on hyphens)
    if (word.includes('-')) {
      return word.split('-').reduce((sum, part) => sum + this.countSyllables(part), 0);
    }

    let syllables = 0;
    let prevVowel = false;

    // Vowels including 'y' in certain positions
    const isVowel = (char, index, word) => {
      if ('aeiou'.includes(char)) return true;
      // 'y' is a vowel when not at the start and not followed by a vowel
      if (char === 'y' && index > 0) return true;
      return false;
    };

    // Count vowel groups
    for (let i = 0; i < word.length; i++) {
      const currVowel = isVowel(word[i], i, word);
      if (currVowel && !prevVowel) {
        syllables++;
      }
      prevVowel = currVowel;
    }

    // Adjustments for common patterns
    // Silent 'e' at end
    if (word.endsWith('e') && !word.endsWith('le') && !word.endsWith('ee') && !word.endsWith('ie')) {
      syllables = Math.max(1, syllables - 1);
    }

    // -ed ending (usually silent unless preceded by t or d)
    if (word.endsWith('ed') && word.length > 3) {
      const beforeEd = word[word.length - 3];
      if (!'td'.includes(beforeEd)) {
        syllables = Math.max(1, syllables - 1);
      }
    }

    // -es ending (usually silent unless preceded by certain consonants)
    if (word.endsWith('es') && word.length > 3) {
      const beforeEs = word[word.length - 3];
      if (!'sxzh'.includes(beforeEs) && !word.endsWith('ches') && !word.endsWith('shes')) {
        syllables = Math.max(1, syllables - 1);
      }
    }

    return Math.max(1, syllables);
  },

  /**
   * Extract sentences from text with high accuracy
   * Handles abbreviations, decimals, quotes, and edge cases
   * @param {string} text - The text to analyze
   * @returns {string[]} - Array of sentences
   */
  extractSentences(text) {
    if (!text || text.trim().length === 0) return [];

    // Normalize whitespace and clean up
    let normalized = text
      .replace(/\s+/g, ' ')
      .replace(/\u00A0/g, ' ')  // Non-breaking space
      .trim();

    // Protect URLs
    normalized = normalized.replace(/https?:\/\/[^\s]+/g, '<URL>');

    // Protect email addresses
    normalized = normalized.replace(/[\w.-]+@[\w.-]+\.\w+/g, '<EMAIL>');

    // Protect decimal numbers and currency
    normalized = normalized.replace(/(\d)\.(\d)/g, '$1<DEC>$2');
    normalized = normalized.replace(/\$[\d,.]+/g, match => match.replace(/\./g, '<DEC>'));

    // Protect ellipsis
    normalized = normalized.replace(/\.{2,}/g, '<ELLIP>');

    // Protect common abbreviations
    const abbrPattern = Array.from(this.ABBREVIATIONS).join('|');
    const abbrRegex = new RegExp(`\\b(${abbrPattern})\\.(?=\\s|$)`, 'gi');
    normalized = normalized.replace(abbrRegex, '$1<ABBR>');

    // Protect initials (e.g., J. K. Rowling, U. S. A.)
    normalized = normalized.replace(/\b([A-Z])\.\s(?=[A-Z]\.?\s?)/g, '$1<INIT> ');

    // Protect numbered lists (1. 2. 3.)
    normalized = normalized.replace(/^(\d+)\.\s/gm, '$1<NUM> ');
    normalized = normalized.replace(/\s(\d+)\.\s/g, ' $1<NUM> ');

    // Split on sentence-ending punctuation followed by space and capital letter (or end)
    const sentences = normalized
      .replace(/([.!?])\s+(?=[A-Z"'([{]|$)/g, '$1<SPLIT>')
      .replace(/([.!?])$/g, '$1<SPLIT>')  // Handle end of text
      .split('<SPLIT>')
      .map(s => {
        // Restore protected markers
        return s
          .replace(/<URL>/g, '[URL]')
          .replace(/<EMAIL>/g, '[EMAIL]')
          .replace(/<ABBR>/g, '.')
          .replace(/<DEC>/g, '.')
          .replace(/<ELLIP>/g, '...')
          .replace(/<INIT>/g, '.')
          .replace(/<NUM>/g, '.')
          .trim();
      })
      .filter(s => {
        // Must have at least 3 words and some alphabetic content
        const words = s.split(/\s+/).filter(w => /[a-zA-Z]/.test(w));
        return s.length > 5 && words.length >= 3;
      });

    return sentences;
  },

  /**
   * Extract words from text with high accuracy
   * Handles contractions, hyphenated words, and filters noise
   * @param {string} text - The text to analyze
   * @returns {string[]} - Array of words
   */
  extractWords(text) {
    if (!text) return [];

    let cleaned = text
      // Remove URLs
      .replace(/https?:\/\/[^\s]+/g, '')
      // Remove email addresses
      .replace(/[\w.-]+@[\w.-]+\.\w+/g, '')
      // Remove code-like content (common in tech pages)
      .replace(/[<>{}[\]]/g, ' ')
      // Remove standalone numbers and numbers with units
      .replace(/\b\d+([.,]\d+)*\s*(%|px|em|rem|pt|cm|mm|in|kg|lb|oz|km|mi|mph|fps)?\b/gi, '')
      // Replace non-word characters except apostrophes within words
      .replace(/[^\w\s'-]/g, ' ')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim();

    // Split and process words
    return cleaned
      .split(/\s+/)
      .flatMap(word => {
        word = word.toLowerCase().trim();

        // Split hyphenated compounds into separate words for counting
        // But keep contractions together
        if (word.includes('-') && !word.includes("'")) {
          return word.split('-').filter(w => w.length > 0);
        }
        return [word];
      })
      .filter(w => {
        if (w.length < 2) return false;
        if (!/^[a-z]/i.test(w)) return false;
        // Must be at least 50% letters
        const letterCount = (w.match(/[a-z]/gi) || []).length;
        if (letterCount < w.length * 0.5) return false;
        // Filter out common non-words
        if (/^[-']+$/.test(w)) return false;
        return true;
      });
  },

  /**
   * Identify complex words (3+ syllables) excluding common easy words
   * @param {string[]} words - Array of words
   * @returns {Object} - Object with complex words array and ratio
   */
  identifyComplexWords(words) {
    const complexWords = words.filter(word => {
      // Skip short words
      if (word.length < 6) return false;

      // Skip common polysyllabic words that are actually easy
      if (this.COMMON_POLYSYLLABIC.has(word)) return false;

      // Check syllable count
      const syllables = this.countSyllables(word);
      return syllables >= 3;
    });

    // Get unique complex words for the list
    const uniqueComplexWords = [...new Set(complexWords)];

    return {
      words: uniqueComplexWords,
      count: complexWords.length,
      ratio: words.length > 0 ? complexWords.length / words.length : 0
    };
  },

  /**
   * Calculate Flesch-Kincaid Grade Level
   * @param {number} totalWords - Total word count
   * @param {number} totalSentences - Total sentence count
   * @param {number} totalSyllables - Total syllable count
   * @returns {number} - Grade level (0-18+)
   */
  calculateFleschKincaid(totalWords, totalSentences, totalSyllables) {
    if (totalSentences === 0 || totalWords === 0) return 0;

    const avgWordsPerSentence = totalWords / totalSentences;
    const avgSyllablesPerWord = totalSyllables / totalWords;

    // Flesch-Kincaid Grade Level formula
    const gradeLevel = 0.39 * avgWordsPerSentence + 11.8 * avgSyllablesPerWord - 15.59;

    return Math.max(0, Math.round(gradeLevel * 10) / 10);
  },

  /**
   * Calculate estimated reading time with research-backed values
   * @param {number} wordCount - Number of words
   * @param {string} level - Difficulty level ('Easy', 'Medium', 'Hard')
   * @returns {Object} - Reading time with min/max and formatted string
   */
  calculateReadingTime(wordCount, level = 'Medium') {
    if (wordCount === 0) {
      return { minutes: 0, formatted: '< 1 min', wpm: 0 };
    }

    // Use a consistent 250 WPM for most calculations
    // This is more intuitive and matches user expectations
    const baseWPM = this.READING_SPEEDS[level.toUpperCase()] || this.READING_SPEEDS.MEDIUM;

    // Simple calculation - just divide and round
    const exactMinutes = wordCount / baseWPM;
    const minutes = Math.round(exactMinutes);

    // Format the output - keep it simple, single number
    let formatted;
    if (exactMinutes < 0.5) {
      formatted = '< 1 min';
    } else if (minutes === 1) {
      formatted = '1 min';
    } else {
      formatted = `${minutes} mins`;
    }

    return {
      minutes: minutes,
      wpm: baseWPM,
      formatted: formatted
    };
  },

  /**
   * Classify sentence length quality
   * @param {number} avgLength - Average words per sentence
   * @returns {Object} - Quality label and color class
   */
  classifySentenceQuality(avgLength) {
    const { SENTENCE } = this.LABELS;
    if (avgLength < 8) {
      return { ...SENTENCE.TOO_SHORT, quality: 'short' };
    } else if (avgLength <= 12) {
      return { ...SENTENCE.SHORT, quality: 'short-ok' };
    } else if (avgLength <= 18) {
      return { ...SENTENCE.OPTIMAL, quality: 'optimal' };
    } else if (avgLength <= 25) {
      return { ...SENTENCE.LONG, quality: 'long' };
    } else {
      return { ...SENTENCE.TOO_LONG, quality: 'too-long' };
    }
  },

  /**
   * Classify word count category
   * @param {number} wordCount - Total word count
   * @returns {Object} - Category label and color class
   */
  classifyWordCount(wordCount) {
    const { WORD_COUNT } = this.LABELS;
    if (wordCount < 300) {
      return { ...WORD_COUNT.QUICK, category: 'quick' };
    } else if (wordCount <= 700) {
      return { ...WORD_COUNT.SHORT, category: 'short' };
    } else if (wordCount <= 1400) {
      return { ...WORD_COUNT.MEDIUM, category: 'medium' };
    } else if (wordCount <= 2500) {
      return { ...WORD_COUNT.LONG, category: 'long' };
    } else {
      return { ...WORD_COUNT.DEEP, category: 'deep' };
    }
  },

  /**
   * Classify readability level using Flesch-Kincaid and multiple factors
   * Applies scientific reliability adjustments for small sample sizes
   * @param {number} avgSentenceLength - Average words per sentence
   * @param {number} complexRatio - Ratio of complex words
   * @param {number} fkGrade - Flesch-Kincaid grade level
   * @param {number} wordCount - Total word count (for reliability)
   * @returns {string} - 'Easy', 'Medium', or 'Hard'
   */
  classifyReadability(avgSentenceLength, complexRatio, fkGrade = null, wordCount = 0) {
    // Statistical reliability threshold: FK needs ~100+ words for reliable results
    // For very short texts, return Medium (insufficient data for extreme ratings)
    if (wordCount < 100) {
      return 'Medium'; // Not enough text for confident classification
    }

    // If we have FK grade, use it as primary indicator
    if (fkGrade !== null) {
      let level;

      if (fkGrade <= 6) {
        level = 'Easy';
      } else if (fkGrade <= 12) {
        level = 'Medium';
      } else {
        level = 'Hard';
      }

      // For short texts (100-300 words), soften extreme ratings
      // Statistical variance is higher with smaller samples
      if (wordCount < 300 && level === 'Hard' && fkGrade < 15) {
        return 'Medium'; // Avoid over-confidence on short hard texts
      }

      return level;
    }

    // Fallback to threshold-based classification
    const { SENTENCE_LENGTH, COMPLEX_RATIO } = this.THRESHOLDS;

    // Calculate a composite score
    let score = 0;

    // Sentence length contribution (0-2 points)
    if (avgSentenceLength <= SENTENCE_LENGTH.EASY) {
      score += 0;
    } else if (avgSentenceLength <= SENTENCE_LENGTH.MEDIUM) {
      score += 1;
    } else {
      score += 2;
    }

    // Complex word ratio contribution (0-2 points)
    if (complexRatio <= COMPLEX_RATIO.EASY) {
      score += 0;
    } else if (complexRatio <= COMPLEX_RATIO.HARD) {
      score += 1;
    } else {
      score += 2;
    }

    // Classify based on composite score
    let result;
    if (score <= 1) {
      result = 'Easy';
    } else if (score <= 2) {
      result = 'Medium';
    } else {
      result = 'Hard';
    }

    // Apply same short-text softening for fallback method
    if (wordCount < 300 && result === 'Hard') {
      return 'Medium';
    }

    return result;
  },

  /**
   * Count clauses in a sentence based on punctuation and connecting words
   * @param {string} sentence - The sentence to analyze
   * @returns {number} - Number of clauses
   */
  countClauses(sentence) {
    // Only count strong clause starters, removing simple coordinating conjunctions 'and', 'or' to reduce noise
    const connectingWords = [
      'however', 'therefore', 'moreover', 'furthermore', 'nevertheless', // Transitions
      'because', 'since', 'although', 'though', 'while', 'whereas', 'unless', 'until', // Subordinating
      'which', 'who', 'whom', 'whose', 'where', 'when', 'whether', // Relative
      'if', 'provided', 'assuming' // Conditional
    ];

    let clauseCount = 1; // Start with 1 (main clause)

    // Count semicolons and colons as strong clause separators
    const strongPunctuation = sentence.match(/[;:]/g);
    if (strongPunctuation) {
      clauseCount += strongPunctuation.length;
    }

    // Count connecting words but be careful about context
    const lowerSentence = sentence.toLowerCase();
    for (const word of connectingWords) {
      // Look for the word preceded by punctuation or start of string, 
      // OR followed by a comma (for transition words)
      const regex = new RegExp(`(?:^|[,;]\\s+)\\b${word}\\b`, 'gi');
      const matches = lowerSentence.match(regex);
      if (matches) {
        clauseCount += matches.length;
      }
    }

    // Check for 'that' explicitly as it's common but noisy
    // Only count 'that' if it's not 'so that' or 'such that'
    const thatMatches = lowerSentence.match(/\b(?<!so\s|such\s)that\b/gi);
    if (thatMatches) {
      // limit impact of 'that' to avoid overcounting relative clauses
      clauseCount += Math.min(thatMatches.length, 3);
    }

    return clauseCount;
  },

  /**
   * Identify complex sentences based on clause density within paragraphs
   * @param {string[]} paragraphs - Array of paragraph texts
   * @returns {Object[]} - Array of complex sentence objects with paragraph index
   */
  identifyComplexSentences(paragraphs) {
    const threshold = this.THRESHOLDS.CLAUSE_DENSITY.COMPLEX;
    const complexSentences = [];
    let globalSentenceIndex = 0;

    paragraphs.forEach((paragraphText, pIndex) => {
      const pSentences = this.extractSentences(paragraphText);

      pSentences.forEach((sentence) => {
        const clauseCount = this.countClauses(sentence);
        const words = this.extractWords(sentence);

        // A sentence is complex if it has many clauses AND is reasonably long
        // We avoid flagging short sentences that happen to have "which" or "that"
        if (clauseCount >= 3 && words.length >= 20) {
          complexSentences.push({
            text: sentence,
            clauseCount: clauseCount,
            wordCount: words.length,
            index: globalSentenceIndex, // Keep global index for compatibility
            paragraphIndex: pIndex, // Critical for robust highlighting
            isComplex: true
          });
        }
        globalSentenceIndex++;
      });
    });

    return complexSentences;
  },

  /**
   * Analyze paragraphs for density
   * Uses multiple factors for accurate detection
   * @param {string[]} paragraphs - Array of paragraph texts
   * @returns {Object[]} - Array of dense paragraph objects
   */
  identifyDenseParagraphs(paragraphs) {
    const { DENSE, MIN_SENTENCES } = this.THRESHOLDS.PARAGRAPH_DENSITY;

    return paragraphs
      .map((para, index) => {
        const words = this.extractWords(para);
        const sentences = this.extractSentences(para);
        const avgSentenceLength = sentences.length > 0 ? words.length / sentences.length : 0;

        // A paragraph is considered dense if:
        // 1. It has 100+ words AND 4+ sentences (wall of text)
        // 2. OR 150+ words regardless of sentence count (very long paragraph)
        // 3. OR 80+ words with 25+ words per sentence (complex sentences)
        const isDenseByLength = words.length >= DENSE && sentences.length >= MIN_SENTENCES;
        const isVeryLong = words.length >= 150;
        const isComplexAndLong = words.length >= 80 && avgSentenceLength >= 25;

        return {
          text: para,
          index: index,
          wordCount: words.length,
          sentenceCount: sentences.length,
          avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
          isDense: isDenseByLength || isVeryLong || isComplexAndLong
        };
      })
      .filter(p => p.isDense);
  },

  /**
   * Main analysis function
   * @param {string} text - The full text to analyze
   * @param {string[]} paragraphs - Array of paragraph texts (for paragraph analysis)
   * @returns {Object} - Complete analysis results
   */
  analyzeText(text, paragraphs = []) {
    // Extract core data
    const sentences = this.extractSentences(text);
    const words = this.extractWords(text);

    // Calculate total syllables for FK grade
    const totalSyllables = words.reduce((sum, word) => sum + this.countSyllables(word), 0);

    // Calculate metrics
    const complexWordData = this.identifyComplexWords(words);
    const avgSentenceLength = sentences.length > 0 ? words.length / sentences.length : 0;
    const fkGrade = this.calculateFleschKincaid(words.length, sentences.length, totalSyllables);

    // Classify readability (with word count for reliability adjustments)
    const level = this.classifyReadability(avgSentenceLength, complexWordData.ratio, fkGrade, words.length);

    // Calculate reading time based on difficulty
    const readingTime = this.calculateReadingTime(words.length, level);

    // Classify sentence quality
    const sentenceQuality = this.classifySentenceQuality(avgSentenceLength);

    // Classify word count category
    const wordCountCategory = this.classifyWordCount(words.length);

    // Identify issues for highlighting
    const complexSentences = this.identifyComplexSentences(paragraphs);
    const denseParagraphs = this.identifyDenseParagraphs(paragraphs);

    return {
      // Core metrics
      level: level,
      grade: fkGrade, // Core metric needed for UI label
      readingTime: readingTime,
      wordCount: words.length,
      wordCountCategory: wordCountCategory,
      sentenceCount: sentences.length,
      avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
      sentenceQuality: sentenceQuality,

      // Reliability indicator
      isLowConfidence: words.length < 100, // Not enough text for highly reliable analysis

      // Issues for highlighting
      issues: {
        complexSentences: complexSentences,
        denseParagraphs: denseParagraphs
      },

      // Summary counts
      issueCount: complexSentences.length + denseParagraphs.length
    };
  }
};

// Export for use in content script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReadScoreAnalyzer;
} else if (typeof window !== 'undefined') {
  window.ReadScoreAnalyzer = ReadScoreAnalyzer;
}
