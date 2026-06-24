"""Open-weather lookup via Open-Meteo (no API key required)."""
from __future__ import annotations

import logging
import re

import httpx

log = logging.getLogger(__name__)

_WMO: dict[int, str] = {
    0: "clear skies",
    1: "mainly clear",
    2: "partly cloudy",
    3: "overcast",
    45: "foggy",
    48: "foggy",
    51: "light drizzle",
    53: "drizzle",
    55: "heavy drizzle",
    61: "light rain",
    63: "rain",
    65: "heavy rain",
    71: "light snow",
    73: "snow",
    75: "heavy snow",
    80: "rain showers",
    81: "rain showers",
    82: "heavy rain showers",
    95: "thunderstorms",
}


def extract_weather_location(transcript: str, args: dict | None, profile_meta: dict | None) -> str:
    if args and args.get("location"):
        return str(args["location"]).strip()
    text = (transcript or "").strip()
    for pat in (
        r"\bweather(?:\s+like)?\s+(?:in|for|at)\s+(.+?)(?:\?|$)",
        r"\b(?:forecast|temperature)\s+(?:in|for|at)\s+(.+?)(?:\?|$)",
        r"\bhow(?:'s| is)\s+the\s+weather\s+(?:in|at)\s+(.+?)(?:\?|$)",
    ):
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            loc = m.group(1).strip().rstrip(".")
            if loc:
                return loc
    meta = profile_meta or {}
    for key in ("location", "city", "home_city"):
        val = str(meta.get(key) or "").strip()
        if val:
            return val
    return ""


async def geocode_place(name: str) -> dict | None:
    q = (name or "").strip()
    if not q:
        return None
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(
                "https://geocoding-api.open-meteo.com/v1/search",
                params={"name": q, "count": 1, "language": "en", "format": "json"},
            )
            resp.raise_for_status()
            results = (resp.json().get("results") or [])
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        log.warning("weather geocode failed for %r: %s", q, exc)
        return None
    if not results:
        return None
    top = results[0]
    return {
        "name": str(top.get("name") or q),
        "country": str(top.get("country") or ""),
        "latitude": float(top["latitude"]),
        "longitude": float(top["longitude"]),
        "timezone": str(top.get("timezone") or "auto"),
    }


async def fetch_current_weather(location: str) -> dict | None:
    place = await geocode_place(location)
    if not place:
        return None
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(
                "https://api.open-meteo.com/v1/forecast",
                params={
                    "latitude": place["latitude"],
                    "longitude": place["longitude"],
                    "current": "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m",
                    "timezone": place["timezone"],
                },
            )
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        log.warning("weather forecast failed: %s", exc)
        return None
    current = data.get("current") or {}
    code = int(current.get("weather_code") or 0)
    label = _WMO.get(code, "variable conditions")
    temp = current.get("temperature_2m")
    humidity = current.get("relative_humidity_2m")
    wind = current.get("wind_speed_10m")
    place_label = place["name"]
    if place.get("country"):
        place_label = f"{place['name']}, {place['country']}"
    return {
        "place": place_label,
        "description": label,
        "temperature_c": temp,
        "humidity_pct": humidity,
        "wind_kmh": wind,
    }


def format_weather_spoken(weather: dict) -> str:
    parts = [f"In {weather['place']}, it's {weather['description']}"]
    if weather.get("temperature_c") is not None:
        parts.append(f"around {round(float(weather['temperature_c']))} degrees Celsius")
    if weather.get("humidity_pct") is not None:
        parts.append(f"humidity {int(weather['humidity_pct'])} percent")
    return ". ".join(parts) + "."
