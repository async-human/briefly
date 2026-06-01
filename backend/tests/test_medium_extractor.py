from briefly_api.services.medium_extractor import (
    detect_medium_digest,
    extract_article_previews,
    extract_article_urls,
    resolve_medium_href,
)


def test_resolve_redirect_medium_systems():
    href = (
        "https://redirect.medium.systems/r/abc123?"
        "url=https%3A%2F%2Ftowardsdatascience.com%2Fgenai-guide-a1b2c3d4e5f6"
    )
    resolved = resolve_medium_href(href)
    assert resolved == "https://towardsdatascience.com/genai-guide-a1b2c3d4e5f6"


def test_resolve_custom_publication_domain():
    href = "https://towardsdatascience.com/building-llm-apps-abc123def456"
    assert resolve_medium_href(href) == href


def test_resolve_medium_p_path():
    href = "https://medium.com/p/abc123def45678"
    assert resolve_medium_href(href) == href


def test_extract_from_redirect_html():
    html = """
    <html><body>
      <a href="https://redirect.medium.systems/r/x?url=https%3A%2F%2Fmedium.com%2F%40john%2Fai-trends-abc123456789">
        How Generative AI Is Changing ML
      </a>
    </body></html>
    """
    previews = extract_article_previews(html)
    assert len(previews) == 1
    assert "Generative AI" in previews[0]["title"]
    assert "abc123456789" in previews[0]["url"]
    assert len(extract_article_urls(html)) == 1


def test_detect_medium_digest_by_html():
    html = '<a href="https://redirect.medium.systems/r/1?url=https%3A%2F%2Fmedium.com%2Fp%2Fabc123456789">Read</a>'
    assert detect_medium_digest(html, "newsletter@other.com") is True
