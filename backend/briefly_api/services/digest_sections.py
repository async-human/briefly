"""Canonical digest section labels — used by planner, writer, and frontend."""

SECTION_WHATS_NEW = "What's new"
SECTION_HIGHLY_RELEVANT = "Highly relevant to you"
SECTION_WORTH_DISCOVERING = "Worth discovering"

# Display order for grouped UI (brain dumps use their own section constant).
SECTION_DISPLAY_ORDER = (
    SECTION_WHATS_NEW,
    SECTION_HIGHLY_RELEVANT,
    SECTION_WORTH_DISCOVERING,
)
