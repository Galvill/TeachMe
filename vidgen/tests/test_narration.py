import pytest

from vidgen.narration import CueNotFound, NarrationError, find_cue, norm, parse_narration, to_spoken


def test_markers_stripped():
    n = parse_narration("Ask   {r}the resolver\n now")
    assert n.words == ["Ask", "the", "resolver", "now"]
    assert n.marks == {"r": 1}
    assert n.text == "Ask the resolver now"
    assert n.norms == ["ask", "the", "resolver", "now"]

    # A separate marker, and one trailing its word, both name the next word.
    n = parse_narration("Ask {a} the resolver{b} now")
    assert n.words == ["Ask", "the", "resolver", "now"]
    assert n.marks == {"a": 1, "b": 3}


def test_marker_without_word():
    with pytest.raises(NarrationError) as err:
        parse_narration("It ends here {x}")
    assert str(err.value) == 'marker "{x}" has no word after it'
    with pytest.raises(NarrationError):
        parse_narration("It ends here{x}")


def test_duplicate_marker():
    with pytest.raises(NarrationError) as err:
        parse_narration("{x}one {x}two")
    assert str(err.value) == 'duplicate marker "{x}"'


def test_norm():
    assert norm("example.com") == norm("Example.com?") == "examplecom"


def test_pron_whole_word_only():
    n = parse_narration("DNS and DNSSEC and dns")
    s = to_spoken(n, {"DNS": "D N S"})
    assert s.tokens == ["D", "N", "S", "and", "DNSSEC", "and", "dns"]
    assert s.source == [0, 0, 0, 1, 2, 3, 4]
    assert s.text == "D N S and DNSSEC and dns"


def test_pron_keeps_punctuation():
    n = parse_narration('Ask "DNS," then (example.com)?')
    s = to_spoken(n, {"DNS": "D N S", "example.com": "example dot com"})
    assert s.tokens == ['Ask', '"D', "N", 'S,"', "then", "(example", "dot", "com)?"]
    assert s.source == [0, 1, 1, 1, 2, 3, 3, 3]


def test_cue_after_previous():
    n = parse_narration("the resolver asks the root, then the resolver asks the TLD")
    first = find_cue(n, "resolver", None, None)
    assert first == 1
    assert find_cue(n, "resolver", None, first) == 7
    assert find_cue(n, "Root", None, None) == 4


def test_cue_occurrence_absolute():
    n = parse_narration("the resolver asks the root, then the resolver asks the TLD")
    assert find_cue(n, "resolver", 1, 9) == 1
    assert find_cue(n, "resolver", 2, None) == 7
    with pytest.raises(CueNotFound):
        find_cue(n, "resolver", 3, None)


def test_mark_beats_word():
    n = parse_narration("the {resolver}cache and the resolver")
    assert find_cue(n, "resolver", None, None) == 1
    assert find_cue(n, "resolver", None, 3) == 1


def test_cue_not_found():
    n = parse_narration("the resolver asks the root")
    with pytest.raises(CueNotFound) as err:
        find_cue(n, "resolvr", None, None)
    assert err.value.name == "resolvr"
    with pytest.raises(CueNotFound):
        find_cue(n, "resolver", None, 1)
