"""Evidence guide that works without an AI model.

When no language model is configured (or the provider fails), questions are
answered from the same site report the UI shows: verdict, reasons, terrain,
geology, rover position and route metrics. The answer is assembled from
templates, cites the datasets it used, and says plainly that it was not written
by a model. Nothing is estimated beyond the report.
"""
from __future__ import annotations

import re

from .landing import assessment, surface_routes
from .profiles import PROFILES
from .site_intel import site_report

SOURCES = {
    "CTX": "https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic",
    "MOLA": "https://pds-geosciences.wustl.edu/missions/mgs/megdr.html",
    "CRATERS": "https://doi.org/10.1029/2011JE003966",
    "SIM3464": "https://doi.org/10.3133/sim3464",
    "M2020": "https://science.nasa.gov/mission/mars-2020-perseverance/location-map/",
    "SWIM": "https://science.nasa.gov/resource/swim-map-shows-subsurface-water-ice-on-mars/",
}
# Order matters: the first topic whose keywords appear wins.
TOPICS = [
    ("route", r"route|path|traverse|drive|walk|مسار|طريق|تنقل|أمشي|امشي"),
    ("landing", r"land|touchdown|ellipse|هبوط|يهبط|الهبوط"),
    ("water", r"water|ice|settle|habitat|resource|ماء|مياه|جليد|استيطان|موارد"),
    ("geology", r"geolog|rock|unit|mineral|جيولوج|صخر|وحدة|معادن"),
    ("rover", r"rover|perseverance|panorama|image|عربة|بيرسيفيرانس|صورة"),
    ("risk", r"risk|hazard|danger|safe|slope|crater|خطر|مخاطر|آمن|امن|ميل|فوهة"),
]
VERDICT_AR = {"go": "يمكن الذهاب ضمن حدود النموذج", "caution": "يمكن الذهاب بحذر", "no_go": "لا يمكن الذهاب",
              "unknown": "غير مؤكد، البيانات لا تكفي"}
ROUGH_WARN_M = 1.2
WEIGHTS = {"slope": 30, "craters": 15, "roughness": 20, "zone": 25, "access": 10}


def is_arabic(text: str) -> bool:
    return bool(re.search(r"[؀-ۿ]", text))


def topic_of(question: str) -> str:
    lowered = question.lower()
    return next((topic for topic, pattern in TOPICS if re.search(pattern, lowered)), "general")


def _num(value, digits=1):
    return "—" if value is None else f"{value:.{digits}f}"


def _terrain_key(report: dict) -> str:
    return "CTX" if report["terrain"]["level"] == "local" else "MOLA"


def _route_metrics(lat: float, lon: float):
    routes = surface_routes(lat, lon)
    if not routes or not routes.get("routes"):
        return None
    safest = routes["routes"].get("safest") or next(iter(routes["routes"].values()))
    return safest["metrics"]


def local_answer(question: str, lat: float, lon: float) -> dict:
    report = site_report(lat, lon, PROFILES["astronaut_eva"])
    arabic, topic = is_arabic(question), topic_of(question)
    t, v, g, rover = report["terrain"], report["verdict"], report["geology"], report["rover"]
    key = _terrain_key(report)
    name = report["region"]["displayName"]
    blocking = [r["text"] for r in v["reasons"] if r["severity"] in ("block", "warn")]
    used = {key}
    lines: list[str] = []

    if arabic:
        lines.append(f"{name}: {VERDICT_AR[v['status']]} (لرائد فضاء مشيًا، حد الميل {report['profile']['maxSlopeDeg']:.0f}°) [{key}].")
    else:
        lines.append(f"{name}: {v['labelEn'] if 'labelEn' in v else v['label']} for an astronaut on foot "
                     f"(slope limit {report['profile']['maxSlopeDeg']:.0f}°) [{key}].")

    if topic == "route":
        metrics = _route_metrics(lat, lon) if t["level"] == "local" else None
        if metrics:
            minutes = metrics["duration_s"] / 60
            lines.append(f"لعربة الاستطلاع الخفيفة، أقل مسار خطورة إلى نقطة مقارنة قريبة: {metrics['distance_m']:.0f} م، حوالي {minutes:.0f} دقيقة، أقصى ميل {metrics['max_slope_deg']:.1f}°، مؤشر خطر {metrics['risk_score']:.0f}/100 [CTX]."
                         if arabic else
                         f"For the light scout rover, the lowest-risk route to a nearby comparison point is {metrics['distance_m']:.0f} m, about {minutes:.0f} min, "
                         f"max slope {metrics['max_slope_deg']:.1f}°, risk index {metrics['risk_score']:.0f}/100 [CTX].")
            lines.append("افتح مخطط المسار لتحديد A وB بنفسك ومقارنة المسارات الثلاثة." if arabic
                         else "Open the Route Planner to set A and B yourself and compare all three routes.")
        else:
            lines.append("لا توجد تضاريس محلية بدقة 20 م هنا، لذلك لا يُحسب مسار؛ المجهول لا يُعامل كآمن." if arabic
                         else "There is no 20 m local terrain here, so no route is calculated; unknown ground is not treated as safe.")
    elif topic == "landing":
        lines.append(f"الميل {_num(t['slopeDeg'])}°، الخشونة {_num(t['roughnessM'], 2)} م، دقة البيانات {t['resolutionM']:.0f} م [{key}]." if arabic
                     else f"Slope {_num(t['slopeDeg'])}°, roughness {_num(t['roughnessM'], 2)} m RMS, data resolution {t['resolutionM']:.0f} m [{key}].")
        if report["landingEllipse"]:
            used.add("SIM3464")
            lines.append("النقطة داخل قطع هبوط Perseverance المنشور [SIM3464]." if arabic
                         else "The point lies inside the published Perseverance landing ellipse [SIM3464].")
        if report["crater"]:
            used.add("CRATERS")
            lines.append(f"أقرب حافة فوهة كبيرة على بعد {report['crater']['rimDistanceKm']:.1f} كم [CRATERS]." if arabic
                         else f"The nearest major crater rim is {report['crater']['rimDistanceKm']:.1f} km away [CRATERS].")
    elif topic == "water":
        used.add("SWIM")
        lines.append("خرائط SWIM تُظهر أدلة إقليمية على جليد تحت السطح، لكن العمق والنقاء وكمية الماء القابلة للاستخراج عند هذه النقطة غير مقاسة [SWIM]." if arabic
                     else "SWIM maps show regional evidence of buried ice, but depth, purity and extractable water at this point are not measured [SWIM].")
    elif topic == "geology":
        if g:
            used.add("SIM3464")
            interpretation = (g.get("interpretation") or "").split(". ")[0]
            lines.append(f"الوحدة الجيولوجية: {g['symbol']} ({g['name']}). التفسير المنشور: {interpretation} [SIM3464]." if arabic
                         else f"Geologic unit {g['symbol']} ({g['name']}). Published interpretation: {interpretation} [SIM3464].")
        else:
            lines.append("النقطة خارج الخريطة الجيولوجية التفصيلية لـ Jezero (مقياس 1:75,000)." if arabic
                         else "The point is outside the detailed Jezero geologic map (1:75,000).")
    elif topic == "rover":
        if rover:
            used.add("M2020")
            far = rover["distanceM"] >= 1000
            distance = f"{rover['distanceM'] / 1000:.1f} km" if far else f"{rover['distanceM']:.0f} m"
            lines.append(f"أقرب موقع مسجّل لعربة Perseverance: اليوم المريخي {rover['sol']}، على بعد {distance}. الصورة من موقع العربة وليست من النقطة المختارة [M2020]." if arabic
                         else f"Nearest recorded Perseverance position: sol {rover['sol']}, {distance} away. Its panorama was taken there, not at the selected point [M2020].")
        else:
            lines.append("لا توجد مواقع مسجّلة لعربة Perseverance قرب هذه النقطة." if arabic
                         else "No recorded Perseverance positions are near this point.")
    else:  # risk / general
        if arabic:
            limit, slope, rough = report["profile"]["maxSlopeDeg"], t["slopeDeg"], t["roughnessM"]
            if slope is None:
                lines.append("لا يمكن حساب الميل عند هذه النقطة من البيانات المتوفرة.")
            elif t["level"] != "local":
                lines.append(f"الميل الإقليمي {slope:.1f}° متوسط على كيلومترات، ولا يكشف المنحدرات والصخور المحلية [MOLA].")
            else:
                relation = "يتجاوز" if slope > limit else "ضمن"
                lines.append(f"الميل {slope:.1f}° {relation} حد الحركة {limit:.0f}° [CTX].")
            if rough is not None and rough > ROUGH_WARN_M:
                lines.append(f"خشونة السطح مرتفعة ({rough:.2f} م) وتزيد صعوبة الحركة [CTX].")
        elif blocking:
            lines.extend(blocking[:3])
        else:
            lines.append(next((r["text"] for r in v["reasons"]), ""))
        if report["crater"]:
            used.add("CRATERS")
            lines.append(f"أقرب حافة فوهة كبيرة: {report['crater']['rimDistanceKm']:.1f} كم [CRATERS]." if arabic
                         else f"Nearest major crater rim: {report['crater']['rimDistanceKm']:.1f} km [CRATERS].")

    lines.append("غير مقاس: الصخور الصغيرة، تماسك التربة، الطقس الحالي، والإشعاع. هذا تقدير تعليمي وليس ضمان أمان." if arabic
                 else "Not measured: small rocks, soil strength, current weather and radiation. This is an educational estimate, not a safety guarantee.")
    answer = " ".join(line for line in lines if line)
    return {"answer": answer, "sources": [{"id": k, "url": SOURCES[k]} for k in SOURCES if k in used],
            "mode": "local", "topic": topic}


def landing_score(report: dict) -> float | None:
    numerator = denominator = 0.0
    for factor in report["factors"]:
        weight = WEIGHTS.get(factor["key"])
        if weight and factor["score"] is not None:
            numerator += factor["score"] * weight
            denominator += weight
    return round(numerator / denominator) if denominator else None


def local_mission_ranking(points: list[tuple[float, float]]) -> dict:
    """Rank saved candidates by the local terrain score; regional-only sites stay unranked."""
    rows = []
    for index, (lat, lon) in enumerate(points, start=1):
        report = assessment(lat, lon)
        score = landing_score(report) if report["level"] == "local" else None
        rows.append({"candidate": index, "name": report["region"]["displayName"], "score": score, "level": report["level"]})
    ranked = sorted([r for r in rows if r["score"] is not None], key=lambda r: -r["score"])
    unranked = [r for r in rows if r["score"] is None]
    lines = []
    if ranked:
        best = ranked[0]
        lines.append(f"أفضل موقع حسب درجة التضاريس المحلية: المرشح {best['candidate']} ({best['name']}) بدرجة {best['score']}/100 [CTX].")
        if len(ranked) > 1:
            lines.append("الترتيب: " + "، ".join(f"{r['candidate']} ({r['score']})" for r in ranked) + ".")
    if unranked:
        lines.append("بدون ترتيب لعدم وجود تضاريس محلية بدقة 20 م: " + "، ".join(f"المرشح {r['candidate']} ({r['name']})" for r in unranked) + " [MOLA].")
    lines.append("الدرجة مؤشر فحص تعليمي من الميل والخشونة والفوهات ومساحة الهبوط، وليست احتمال نجاح. الصخور والتربة والطقس غير مقاسة.")
    used = {"CTX"} if ranked else set()
    if unranked:
        used.add("MOLA")
    return {"answer": " ".join(lines), "sources": [{"id": k, "url": SOURCES[k]} for k in SOURCES if k in used],
            "mode": "local", "ranking": ranked + unranked}
