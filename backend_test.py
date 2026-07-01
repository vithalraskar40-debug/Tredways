"""
Tredways SMC Backend Testing — Bug Fix + New Opportunities Endpoint
Tests the fixed liquidity_grab_and_retest logic and the new /api/opportunities endpoint.
"""
import os
import requests
import time

# Read backend URL from frontend .env
BASE_URL = "https://edee4343-0206-46c8-839e-4dd0df51ee5d.preview.emergentagent.com"
API = f"{BASE_URL}/api"

print(f"Testing backend at: {API}\n")

# Track results
results = {
    "health": None,
    "chart_data": [],
    "smc_analyze": [],
    "opportunities": [],
    "proxies": [],
}
errors = []


def test_health():
    """1. Health check"""
    print("=" * 60)
    print("TEST 1: Health Check")
    print("=" * 60)
    try:
        r = requests.get(f"{API}/health", timeout=10)
        print(f"Status: {r.status_code}")
        data = r.json()
        print(f"Response: {data}")
        
        assert r.status_code == 200, f"Expected 200, got {r.status_code}"
        assert data.get("python") == "ok", f"Python not ok: {data}"
        assert data.get("node_backend") == "ok", f"Node backend not ok: {data}"
        
        results["health"] = "PASS"
        print("✅ PASS: Health check successful\n")
        return True
    except Exception as e:
        results["health"] = f"FAIL: {e}"
        errors.append(f"Health check failed: {e}")
        print(f"❌ FAIL: {e}\n")
        return False


def test_chart_data():
    """2. Chart data endpoint (sanity check)"""
    print("=" * 60)
    print("TEST 2: Chart Data Endpoint")
    print("=" * 60)
    
    test_cases = [
        ("GOLD", "1h"),
        ("GOLD", "15m"),
        ("RELIANCE", "15m"),
        ("BTCUSD", "1h"),
    ]
    
    all_passed = True
    for pair, tf in test_cases:
        try:
            print(f"\nTesting {pair} {tf}...")
            r = requests.post(
                f"{API}/chart-data",
                json={"pair": pair, "timeframe": tf},
                timeout=30
            )
            print(f"Status: {r.status_code}")
            
            assert r.status_code == 200, f"Expected 200, got {r.status_code}"
            data = r.json()
            
            assert "candles" in data, "Missing 'candles' key"
            assert isinstance(data["candles"], list), "candles is not a list"
            assert len(data["candles"]) >= 60, f"Only {len(data['candles'])} candles (need ≥60)"
            assert "live_price" in data, "Missing 'live_price'"
            assert "pair" in data, "Missing 'pair'"
            assert "timeframe" in data, "Missing 'timeframe'"
            
            print(f"  Candles: {len(data['candles'])}")
            print(f"  Live price: {data['live_price']}")
            print(f"  ✅ PASS")
            
            results["chart_data"].append({"pair": pair, "tf": tf, "status": "PASS"})
        except Exception as e:
            all_passed = False
            results["chart_data"].append({"pair": pair, "tf": tf, "status": f"FAIL: {e}"})
            errors.append(f"Chart data {pair} {tf} failed: {e}")
            print(f"  ❌ FAIL: {e}")
    
    print(f"\n{'✅' if all_passed else '❌'} Chart data: {'PASS' if all_passed else 'FAIL'}\n")
    return all_passed


def test_smc_analyze():
    """3. SMC analysis endpoint (the fixed engine)"""
    print("=" * 60)
    print("TEST 3: SMC Analysis (Fixed Engine)")
    print("=" * 60)
    
    test_cases = [
        ("GOLD", "1h"),
        ("GOLD", "15m"),
        ("BTCUSD", "1h"),
        ("BTCUSD", "15m"),
        ("EURUSD", "1h"),
        ("EURUSD", "15m"),
    ]
    
    all_passed = True
    non_none_count = 0
    
    for pair, tf in test_cases:
        try:
            print(f"\nTesting {pair} {tf}...")
            r = requests.post(
                f"{API}/smc-analyze",
                json={"pair": pair, "timeframe": tf},
                timeout=30
            )
            print(f"Status: {r.status_code}")
            
            assert r.status_code == 200, f"Expected 200, got {r.status_code}"
            data = r.json()
            
            # Verify required keys
            assert "atr" in data, "Missing 'atr'"
            assert "current_phase" in data, "Missing 'current_phase'"
            assert "zones" in data, "Missing 'zones'"
            assert "liquidity_grab" in data, "Missing 'liquidity_grab'"
            assert "pair" in data, "Missing 'pair'"
            assert "timeframe" in data, "Missing 'timeframe'"
            assert "last_price" in data, "Missing 'last_price'"
            assert "candles_count" in data, "Missing 'candles_count'"
            
            lg = data["liquidity_grab"]
            direction = lg.get("direction", "NONE")
            
            assert direction in ["LONG", "SHORT", "NONE"], f"Invalid direction: {direction}"
            
            print(f"  ATR: {data['atr']}")
            print(f"  Phase: {data['current_phase']}")
            print(f"  Direction: {direction}")
            print(f"  Grade: {lg.get('grade', 'N/A')}")
            
            # If direction is not NONE, verify all required fields
            if direction != "NONE":
                non_none_count += 1
                print(f"  🎯 Found {direction} setup!")
                
                # Verify required fields
                for field in ["entry", "sl", "tp1", "tp2", "tp3", "rr", "grade"]:
                    assert field in lg and lg[field] is not None, f"Missing or null field: {field}"
                    assert isinstance(lg[field], (int, float)), f"{field} is not a number: {lg[field]}"
                
                entry = lg["entry"]
                sl = lg["sl"]
                tp1 = lg["tp1"]
                grade = lg["grade"]
                
                # Verify sl != entry
                assert sl != entry, f"SL equals entry: {sl}"
                
                # Verify grade is valid
                assert grade in ["A+", "A", "B"], f"Invalid grade: {grade}"
                
                # Verify tp1 is on correct side of entry
                if direction == "LONG":
                    assert tp1 > entry, f"LONG: tp1 ({tp1}) should be > entry ({entry})"
                    assert sl < entry, f"LONG: sl ({sl}) should be < entry ({entry})"
                elif direction == "SHORT":
                    assert tp1 < entry, f"SHORT: tp1 ({tp1}) should be < entry ({entry})"
                    assert sl > entry, f"SHORT: sl ({sl}) should be > entry ({entry})"
                
                print(f"  Entry: {entry}, SL: {sl}, TP1: {tp1}")
                print(f"  R:R: {lg['rr']}")
                print(f"  Reasons: {lg.get('reasons', [])}")
            
            print(f"  ✅ PASS")
            results["smc_analyze"].append({
                "pair": pair, 
                "tf": tf, 
                "status": "PASS",
                "direction": direction,
                "grade": lg.get("grade", "N/A")
            })
            
        except Exception as e:
            all_passed = False
            results["smc_analyze"].append({
                "pair": pair, 
                "tf": tf, 
                "status": f"FAIL: {e}",
                "direction": "ERROR"
            })
            errors.append(f"SMC analyze {pair} {tf} failed: {e}")
            print(f"  ❌ FAIL: {e}")
    
    print(f"\n📊 Summary: {non_none_count} out of {len(test_cases)} returned non-NONE direction")
    
    if non_none_count == 0:
        all_passed = False
        errors.append("CRITICAL: No non-NONE directions found across all 6 test cases (bug fix may not be working)")
        print("❌ CRITICAL: Expected at least 1 non-NONE direction (bug fix verification failed)")
    else:
        print(f"✅ Bug fix verified: At least one non-NONE direction found")
    
    print(f"\n{'✅' if all_passed else '❌'} SMC analysis: {'PASS' if all_passed else 'FAIL'}\n")
    return all_passed


def test_opportunities():
    """4. Opportunities endpoint (NEW)"""
    print("=" * 60)
    print("TEST 4: Opportunities Endpoint (NEW)")
    print("=" * 60)
    
    all_passed = True
    
    # Test 4a: Default (no params)
    print("\n4a. Testing default (no params)...")
    try:
        start_time = time.time()
        r = requests.get(f"{API}/opportunities", timeout=120)
        elapsed = time.time() - start_time
        
        print(f"Status: {r.status_code}")
        print(f"Time: {elapsed:.1f}s")
        
        assert r.status_code == 200, f"Expected 200, got {r.status_code}"
        assert elapsed < 90, f"Took too long: {elapsed:.1f}s (should be < 90s)"
        
        data = r.json()
        assert "count" in data, "Missing 'count'"
        assert "opportunities" in data, "Missing 'opportunities'"
        assert isinstance(data["opportunities"], list), "opportunities is not a list"
        
        print(f"  Count: {data['count']}")
        print(f"  ✅ PASS")
        
        results["opportunities"].append({"test": "default", "status": "PASS", "count": data["count"]})
    except Exception as e:
        all_passed = False
        results["opportunities"].append({"test": "default", "status": f"FAIL: {e}"})
        errors.append(f"Opportunities default failed: {e}")
        print(f"  ❌ FAIL: {e}")
    
    # Test 4b: With specific symbols and timeframes
    print("\n4b. Testing with symbols=GOLD,BTCUSD,EURUSD&timeframes=1h,15m&min_grade=B...")
    try:
        start_time = time.time()
        r = requests.get(
            f"{API}/opportunities",
            params={
                "symbols": "GOLD,BTCUSD,EURUSD",
                "timeframes": "1h,15m",
                "min_grade": "B"
            },
            timeout=120
        )
        elapsed = time.time() - start_time
        
        print(f"Status: {r.status_code}")
        print(f"Time: {elapsed:.1f}s")
        
        assert r.status_code == 200, f"Expected 200, got {r.status_code}"
        data = r.json()
        
        assert "count" in data, "Missing 'count'"
        assert "opportunities" in data, "Missing 'opportunities'"
        
        print(f"  Count: {data['count']}")
        
        # Verify structure of each opportunity
        for i, opp in enumerate(data["opportunities"][:3]):  # Check first 3
            print(f"\n  Opportunity {i+1}:")
            required_fields = [
                "symbol", "timeframe", "direction", "grade", "entry", "sl", 
                "tp1", "tp2", "tp3", "rr", "current_price", "phase", "retest", "reasons"
            ]
            for field in required_fields:
                assert field in opp, f"Missing field: {field}"
            
            # Verify direction is LONG or SHORT (never NONE)
            assert opp["direction"] in ["LONG", "SHORT"], f"Invalid direction: {opp['direction']}"
            
            # Verify grade
            assert opp["grade"] in ["A+", "A", "B"], f"Invalid grade: {opp['grade']}"
            
            print(f"    {opp['symbol']} {opp['timeframe']} {opp['direction']} {opp['grade']}")
            print(f"    Entry: {opp['entry']}, SL: {opp['sl']}, TP1: {opp['tp1']}")
            print(f"    R:R: {opp['rr']}, Retest: {opp['retest']}")
            print(f"    Phase: {opp['phase']}")
        
        print(f"\n  ✅ PASS")
        results["opportunities"].append({
            "test": "filtered", 
            "status": "PASS", 
            "count": data["count"]
        })
        
    except Exception as e:
        all_passed = False
        results["opportunities"].append({"test": "filtered", "status": f"FAIL: {e}"})
        errors.append(f"Opportunities filtered failed: {e}")
        print(f"  ❌ FAIL: {e}")
    
    # Test 4c: min_grade=A+ (should be subset of B)
    print("\n4c. Testing min_grade=A+ (should be subset)...")
    try:
        r = requests.get(
            f"{API}/opportunities",
            params={
                "symbols": "GOLD,BTCUSD,EURUSD",
                "timeframes": "1h,15m",
                "min_grade": "A+"
            },
            timeout=120
        )
        
        print(f"Status: {r.status_code}")
        assert r.status_code == 200, f"Expected 200, got {r.status_code}"
        
        data = r.json()
        print(f"  Count: {data['count']}")
        
        # Verify all returned opportunities are A+ grade
        for opp in data["opportunities"]:
            assert opp["grade"] == "A+", f"Expected A+ grade, got {opp['grade']}"
        
        print(f"  ✅ PASS")
        results["opportunities"].append({
            "test": "min_grade_A+", 
            "status": "PASS", 
            "count": data["count"]
        })
        
    except Exception as e:
        all_passed = False
        results["opportunities"].append({"test": "min_grade_A+", "status": f"FAIL: {e}"})
        errors.append(f"Opportunities min_grade=A+ failed: {e}")
        print(f"  ❌ FAIL: {e}")
    
    print(f"\n{'✅' if all_passed else '❌'} Opportunities: {'PASS' if all_passed else 'FAIL'}\n")
    return all_passed


def test_proxies():
    """5. Proxy endpoints to Node backend"""
    print("=" * 60)
    print("TEST 5: Proxy Endpoints to Node Backend")
    print("=" * 60)
    
    all_passed = True
    
    # Test 5a: POST /api/analyze
    print("\n5a. Testing POST /api/analyze (RELIANCE)...")
    try:
        r = requests.post(
            f"{API}/analyze",
            json={"ticker": "RELIANCE"},
            timeout=45
        )
        print(f"Status: {r.status_code}")
        
        assert r.status_code == 200, f"Expected 200, got {r.status_code}"
        data = r.json()
        assert isinstance(data, dict), "Response is not a dict"
        
        print(f"  ✅ PASS")
        results["proxies"].append({"endpoint": "/analyze", "status": "PASS"})
        
    except Exception as e:
        all_passed = False
        results["proxies"].append({"endpoint": "/analyze", "status": f"FAIL: {e}"})
        errors.append(f"Proxy /analyze failed: {e}")
        print(f"  ❌ FAIL: {e}")
    
    # Test 5b: POST /api/analyze-forex
    print("\n5b. Testing POST /api/analyze-forex (EURUSD)...")
    try:
        r = requests.post(
            f"{API}/analyze-forex",
            json={"pair": "EURUSD"},
            timeout=45
        )
        print(f"Status: {r.status_code}")
        
        assert r.status_code == 200, f"Expected 200, got {r.status_code}"
        data = r.json()
        assert isinstance(data, dict), "Response is not a dict"
        
        print(f"  ✅ PASS")
        results["proxies"].append({"endpoint": "/analyze-forex", "status": "PASS"})
        
    except Exception as e:
        all_passed = False
        results["proxies"].append({"endpoint": "/analyze-forex", "status": f"FAIL: {e}"})
        errors.append(f"Proxy /analyze-forex failed: {e}")
        print(f"  ❌ FAIL: {e}")
    
    # Test 5c: GET /api/scanner
    print("\n5c. Testing GET /api/scanner...")
    try:
        r = requests.get(f"{API}/scanner", timeout=60)
        print(f"Status: {r.status_code}")
        
        assert r.status_code == 200, f"Expected 200, got {r.status_code}"
        data = r.json()
        assert isinstance(data, (list, dict)), "Response is not list or dict"
        
        print(f"  ✅ PASS")
        results["proxies"].append({"endpoint": "/scanner", "status": "PASS"})
        
    except Exception as e:
        all_passed = False
        results["proxies"].append({"endpoint": "/scanner", "status": f"FAIL: {e}"})
        errors.append(f"Proxy /scanner failed: {e}")
        print(f"  ❌ FAIL: {e}")
    
    print(f"\n{'✅' if all_passed else '❌'} Proxies: {'PASS' if all_passed else 'FAIL'}\n")
    return all_passed


def print_summary():
    """Print final summary"""
    print("\n" + "=" * 60)
    print("FINAL SUMMARY")
    print("=" * 60)
    
    print(f"\n1. Health: {results['health']}")
    
    print(f"\n2. Chart Data:")
    for item in results["chart_data"]:
        status_icon = "✅" if item["status"] == "PASS" else "❌"
        print(f"   {status_icon} {item['pair']} {item['tf']}: {item['status']}")
    
    print(f"\n3. SMC Analysis:")
    for item in results["smc_analyze"]:
        status_icon = "✅" if item["status"] == "PASS" else "❌"
        direction = item.get("direction", "N/A")
        grade = item.get("grade", "N/A")
        print(f"   {status_icon} {item['pair']} {item['tf']}: {direction} {grade}")
    
    print(f"\n4. Opportunities:")
    for item in results["opportunities"]:
        status_icon = "✅" if item["status"] == "PASS" else "❌"
        count = item.get("count", "N/A")
        print(f"   {status_icon} {item['test']}: {item['status']} (count: {count})")
    
    print(f"\n5. Proxies:")
    for item in results["proxies"]:
        status_icon = "✅" if item["status"] == "PASS" else "❌"
        print(f"   {status_icon} {item['endpoint']}: {item['status']}")
    
    if errors:
        print(f"\n❌ ERRORS FOUND ({len(errors)}):")
        for i, err in enumerate(errors, 1):
            print(f"   {i}. {err}")
    else:
        print(f"\n✅ ALL TESTS PASSED!")
    
    print("\n" + "=" * 60)


if __name__ == "__main__":
    print("Starting Tredways SMC Backend Tests...\n")
    
    # Run all tests
    health_pass = test_health()
    chart_pass = test_chart_data()
    smc_pass = test_smc_analyze()
    opp_pass = test_opportunities()
    proxy_pass = test_proxies()
    
    # Print summary
    print_summary()
    
    # Exit code
    all_pass = health_pass and chart_pass and smc_pass and opp_pass and proxy_pass
    exit(0 if all_pass else 1)
