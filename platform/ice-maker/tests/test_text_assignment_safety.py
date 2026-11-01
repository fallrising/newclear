"""Generated code observations must remain distinct from credential data."""

import hashlib
from pathlib import Path
import tempfile
import unittest

from ice_maker.extraction import ExtractedChunk
from ice_maker.knowledge_index import IndexError as KnowledgeIndexError, KnowledgeIndex
from ice_maker.production_extraction import ProductionExtractionError, _native_pdf_text


BENIGN_CODE = {
    "function_valued_method": (
        "Toy.prototype.matchesToken = function(element, token){ "
        "return element.matches(token); };"
    ),
    "complete_zero_argument_call": "var token = entries.pop();",
    "comma_separated_declaration": "var token = entries.pop(), matched = false;",
}

# Every credential-looking literal below is generated control data. The marker
# on each literal line is required by the repository's per-line secret scanner.
UNSAFE_CODE = (
    ("token_literal", "token = 'fixture-token-literal';"),  # SYNTHETIC_TEST_SECRET
    ("token_unquoted_literal", "token = fixtureCredentialValue;"),  # SYNTHETIC_TEST_SECRET
    ("token_colon", "token: 'fixture-token-literal'"),  # SYNTHETIC_TEST_SECRET
    ("api_key_literal", "api_key = 'fixture-api-key-literal';"),  # SYNTHETIC_TEST_SECRET
    ("api_key_short_value", "api_key=x;"),  # SYNTHETIC_TEST_SECRET
    ("api_key_unquoted_phrase", "api_key=secret material here;"),  # SYNTHETIC_TEST_SECRET
    ("api_key_colon", "api-key: 'fixture-api-key-literal'"),  # SYNTHETIC_TEST_SECRET
    ("secret_literal", "secret = 'fixture-secret-literal';"),  # SYNTHETIC_TEST_SECRET
    ("password_literal", "password = 'fixture-password-literal';"),  # SYNTHETIC_TEST_SECRET
    ("password_colon", "password: fixturePasswordValue"),  # SYNTHETIC_TEST_SECRET
    ("arbitrary_token_alias", "fooToken = 'fixture-token-literal';"),  # SYNTHETIC_TEST_SECRET
    ("secret_alias", "clientSecret = 'fixture-secret-literal';"),  # SYNTHETIC_TEST_SECRET
    ("password_alias", "resetPassword = 'fixture-password-literal';"),  # SYNTHETIC_TEST_SECRET
    ("api_key_alias", "service_api_key = 'fixture-key-literal';"),  # SYNTHETIC_TEST_SECRET
    ("token_alias_call", "fooToken = entries.pop();"),  # SYNTHETIC_TEST_SECRET
    ("secret_alias_call", "clientSecret = entries.pop();"),  # SYNTHETIC_TEST_SECRET
    ("quoted_call_argument", "token = call('fixture');"),  # SYNTHETIC_TEST_SECRET
    ("identifier_call_argument", "token = call(rawCredentialIdentifier);"),  # SYNTHETIC_TEST_SECRET
    ("numeric_call_argument", "token = call(123);"),  # SYNTHETIC_TEST_SECRET
    ("call_without_delimiter", "token = entries.pop()"),  # SYNTHETIC_TEST_SECRET
    ("appended_literal_expression", "token = entries.pop() + 'fixture';"),  # SYNTHETIC_TEST_SECRET
    ("appended_call_expression", "token = entries.pop()('fixture');"),  # SYNTHETIC_TEST_SECRET
    ("call_then_password", "token = entries.pop(); password = 'fixture';"),  # SYNTHETIC_TEST_SECRET
    ("comma_then_password", "token = entries.pop(), password = 'fixture';"),  # SYNTHETIC_TEST_SECRET
    ("call_then_api_key", "token = entries.pop(); api_key=x;"),  # SYNTHETIC_TEST_SECRET
    ("unsafe_unicode", "token = entries.pop(); \u202e"),  # SYNTHETIC_TEST_SECRET
    ("compatibility_secret", "ｐａｓｓｗｏｒｄ = 'fixture';"),  # SYNTHETIC_TEST_SECRET
    ("nested_credential", "Toy.prototype.matchesToken = function(element, token){ password = 'fixture'; return element.matches(token); };"),  # SYNTHETIC_TEST_SECRET
    ("qualified_token_call", "object.token = entries.pop();"),  # SYNTHETIC_TEST_SECRET
    ("spaced_qualified_token_call", "object . token = entries.pop();"),  # SYNTHETIC_TEST_SECRET
    ("dollar_token_call", "$token = entries.pop();"),  # SYNTHETIC_TEST_SECRET
    ("bare_call", "token = reader();"),  # SYNTHETIC_TEST_SECRET
    ("grouped_expression", "token = (entries.pop(), 'fixture');"),  # SYNTHETIC_TEST_SECRET
    ("function_default_parameter", "Toy.prototype.matchesToken = function(token = 'fixture'){ return token; };"),  # SYNTHETIC_TEST_SECRET
    ("function_rest_parameter", "Toy.prototype.matchesToken = function(...tokens){ return tokens; };"),  # SYNTHETIC_TEST_SECRET
    ("bare_token_function", "token = function(value){ return value; };"),  # SYNTHETIC_TEST_SECRET
    ("hyphenated_token_alias_call", "auth-token = entries.pop();"),  # SYNTHETIC_TEST_SECRET
)


def chunk(text):
    source = "a" * 64
    region = f"text:0,0,{len(text)}"
    identity = hashlib.sha256(
        f"{source}\0{1}\0{region}\0pdf-text\0{text}".encode("utf-8")
    ).hexdigest()
    return ExtractedChunk(source, 1, region, "pdf-text", text, 1.0, identity)


class NativeTextAssignmentSafetyTests(unittest.TestCase):
    def assert_preserved(self, key):
        text = BENIGN_CODE[key]
        self.assertEqual(_native_pdf_text(text.encode("utf-8"), 4096), text)

    def test_function_valued_method_is_not_a_credential_assignment(self):
        self.assert_preserved("function_valued_method")

    def test_complete_zero_argument_call_is_a_lexical_reference(self):
        self.assert_preserved("complete_zero_argument_call")

    def test_comma_separated_declaration_preserves_lexical_reference(self):
        self.assert_preserved("comma_separated_declaration")

    def test_credentials_ambiguous_calls_and_unsafe_unicode_remain_rejected(self):
        for name, text in UNSAFE_CODE:
            with self.subTest(name=name), self.assertRaises(ProductionExtractionError):
                _native_pdf_text(text.encode("utf-8"), 4096)


class IndexedTextAssignmentSafetyTests(unittest.TestCase):
    def assert_preserved(self, key):
        value = chunk(BENIGN_CODE[key])
        with tempfile.TemporaryDirectory() as directory:
            with KnowledgeIndex(Path(directory) / "index.sqlite3") as index:
                index.index_chunks((value,))
                self.assertEqual(index.read_source(value.source_sha256), (value,))

    def test_function_valued_method_is_indexed_and_replayable(self):
        self.assert_preserved("function_valued_method")

    def test_complete_zero_argument_call_is_indexed_and_replayable(self):
        self.assert_preserved("complete_zero_argument_call")

    def test_comma_separated_declaration_is_indexed_and_replayable(self):
        self.assert_preserved("comma_separated_declaration")

    def test_credentials_ambiguous_calls_and_unsafe_unicode_cannot_be_indexed(self):
        for name, text in UNSAFE_CODE:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                with KnowledgeIndex(Path(directory) / "index.sqlite3") as index:
                    with self.assertRaises(KnowledgeIndexError):
                        index.index_chunks((chunk(text),))
                    self.assertEqual(index.search("fixture"), ())


if __name__ == "__main__":
    unittest.main()
