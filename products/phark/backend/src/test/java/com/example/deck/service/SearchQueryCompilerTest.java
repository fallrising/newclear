package com.example.deck.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

class SearchQueryCompilerTest {

    private final SearchQueryCompiler compiler = new SearchQueryCompiler();

    @Test
    void singleTermBecomesQuotedPhrase() {
        assertThat(compiler.compile("ship")).isEqualTo("\"ship\"");
    }

    @Test
    void plainTermsBecomeQuotedPhrasesJoinedByAnd() {
        assertThat(compiler.compile("ship the")).isEqualTo("\"ship\" AND \"the\"");
    }

    @Test
    void caseIsPreservedUnchanged() {
        assertThat(compiler.compile("Ship The")).isEqualTo("\"Ship\" AND \"The\"");
    }

    @Test
    void embeddedQuoteIsDoubledInsideWholeTermPhrase() {
        assertThat(compiler.compile("say\"hi\"now"))
                .isEqualTo("\"say\"\"hi\"\"now\"");
    }

    @Test
    void doubledQuotesNeverEscapeTheQuotedPhraseWrapper() {
        assertThat(compiler.compile("left\"right"))
                .isEqualTo("\"left\"\"right\"");
    }

    @Test
    void amountTermsAreBoundedAtEight() {
        assertThat(compiler.compile("a b c d e f g h"))
                .isEqualTo("\"a\" AND \"b\" AND \"c\" AND \"d\" AND \"e\" AND \"f\" AND \"g\" AND \"h\"");
    }

    @Test
    void hundredCodePointsIsAccepted() {
        assertThat(compiler.compile("a".repeat(100))).isEqualTo("\"".concat("a".repeat(100)).concat("\""));
    }

    @Test
    void unicodeWhitespaceIsStrippedBeforeCodePointLimitIsMeasured() {
        String core = "a".repeat(100);

        assertThat(compiler.compile("\u00A0\u0085" + core + "\u2003\u2029"))
                .isEqualTo("\"".concat(core).concat("\""));
    }

    @Test
    void unicodeLetterTermsAreAcceptedWithoutNormalization() {
        assertThat(compiler.compile("中文 accént"))
                .isEqualTo("\"中文\" AND \"accént\"");
    }

    @Test
    void unicodeNonAsciiWhitespaceSplitsTerms() {
        assertThat(compiler.compile("ship\u00A0the")).isEqualTo("\"ship\" AND \"the\"");
    }

    @Test
    void c0AndC1WhitespaceControlsSplitLikeSeparators() {
        assertThat(compiler.compile("ship\tthe")).isEqualTo("\"ship\" AND \"the\"");
        assertThat(compiler.compile("ship\nthe")).isEqualTo("\"ship\" AND \"the\"");
        assertThat(compiler.compile("ship\r\nthe")).isEqualTo("\"ship\" AND \"the\"");
        assertThat(compiler.compile("ship\u0085the")).isEqualTo("\"ship\" AND \"the\"");
    }

    @Test
    void mixedUnicodeSeparatorsProduceSeparateTerms() {
        assertThat(compiler.compile("a\tb\r\nc\u0085d\u00A0e"))
                .isEqualTo("\"a\" AND \"b\" AND \"c\" AND \"d\" AND \"e\"");
    }

    @Test
    void supplementaryLetterTermSurvivesCodePointLoop() {
        assertThat(compiler.compile("a\uD835\uDC00z")).isEqualTo("\"a\uD835\uDC00z\"");
    }

    @Test
    void mongolianVowelSeparatorDoesNotSplitTerms() {
        assertThat(compiler.compile("ship\u180Ethe")).isEqualTo("\"ship\u180Ethe\"");
        assertThat(compiler.compile("a\u180Eb c")).isEqualTo("\"a\u180Eb\" AND \"c\"");
    }

    @Test
    void formatOnlyMongolianVowelSeparatorTermIsRejectedForLackOfLetterOrDigit() {
        assertThatThrownBy(() -> compiler.compile("\u180E"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid search query");
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {
            "   ",
            "\t\n\r",
            "\u00A0"
    })
    void blankQueryIsRejected(String query) {
        assertThatThrownBy(() -> compiler.compile(query))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid search query");
    }

    @Test
    void queryLongerThanHundredCodePointsIsRejected() {
        assertThatThrownBy(() -> compiler.compile("a".repeat(101)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid search query");
    }

    @Test
    void moreThanEightTermsIsRejected() {
        assertThatThrownBy(() -> compiler.compile("a b c d e f g h i"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid search query");
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "***",
            "( )",
            "---",
            "...",
            "? !",
            "---*_",
            "''''",
            "::::",
            ";;;"
    })
    void punctuationOnlyTermsAreRejected(String query) {
        assertThatThrownBy(() -> compiler.compile(query))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid search query");
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "a\u0000b",
            "a\u0001b",
            "a\u0007b",
            "a\u001fb",
            "a\u007fb",
            "a\u009fb"
    })
    void nonWhitespaceIsoControlCodePointsAreRejected(String query) {
        assertThatThrownBy(() -> compiler.compile(query))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid search query");
    }

    @Test
    void letterSurroundedByQuoteShapedCaretStillCompilesAsLiteralPhrases() {
        String compiled = compiler.compile("foo^bar");

        assertThat(countPhrases(compiled)).isEqualTo(1);
        assertThat(compiled).startsWith("\"").endsWith("\"");
        assertThat(compiled).isEqualTo("\"foo^bar\"");
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "NOT",
            "OR",
            "AND",
            "NEAR",
            "alpha OR beta",
            "(x)",
            "col:values",
            "^tag"
    })
    void ftsOperatorShapedInputCannotChangeOutputStructure(String query) {
        String compiled = compiler.compile(query);

        assertThat(compiled).doesNotContain(" OR ").doesNotContain(" NEAR ")
                .doesNotContain("( ").doesNotContain(" )");
        assertThat(countPhrases(compiled)).isPositive();
        assertThat(compiled).matches("(\"[^\"]*\")( AND \"[^\"]*\")*");
    }

    @Test
    void quotedSnippetInsideOneWholeTermStaysSingleLiteralPhrase() {
        String compiled = compiler.compile("say\"hi\"now");

        assertThat(countPhrases(compiled)).isEqualTo(1);
        assertThat(compiled).isEqualTo("\"say\"\"hi\"\"now\"");
    }

    @Test
    void starInTermStaysInsidePhraseWithoutPrefixSyntax() {
        assertThat(compiler.compile("foo*")).isEqualTo("\"foo*\"");
        assertThat(compiler.compile("*bar")).isEqualTo("\"*bar\"");
    }

    @Test
    void parensAndQuotesShapedInputStayInsideASingleQuotedPhrase() {
        assertThat(compiler.compile("a\"(AND\"b"))
                .isEqualTo("\"a\"\"(AND\"\"b\"");
    }

    @Test
    void isolatedOperatorPunctuationBetweenTermsFailsTheLetterRequirement() {
        assertThatThrownBy(() -> compiler.compile("a ^ b"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid search query");
    }

    @Test
    void colonColumnSyntaxStaysLiteralInsidePhrase() {
        assertThat(compiler.compile("content:news")).isEqualTo("\"content:news\"");
    }

    private static int countPhrases(String compiled) {
        return compiled.split(" AND ").length;
    }
}
