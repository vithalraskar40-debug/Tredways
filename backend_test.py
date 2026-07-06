"""
Tredways SMC Backend Testing — /api/check-trades endpoint
Tests the new trade outcome checker that walks candle history.
"""
import os
import requests
import time
from datetime import datetime, timedelta

# Read backend URL from frontend .env
BASE_URL = "https://code-runner-161.preview.emergentagent.com"
API = f"{BASE_URL}/api"

print(f"Testing backend at: {API}\n")

# Track results
results = {
    "check_trades": [],
    "regression": [],
}
errors = []


def test_check_trades_happy_path():
    """Test 1: Happy path — mixed batch with 4 trades"""
    print("=" * 60)
    print("TEST 1: Happy Path — Mixed Batch (4 trades)")
    print("=" * 60)
    
    try:
        payload = {
            "trades": [
                {
                    "id": "t1",
                    "pair": "BTCUSD",
                    "signal_type": "LONG",
                    "entry": 58000,
                    "sl": 57500,
                    "tp1": 59000,
                    "created_at": "2026-06-30T00:00:00Z"
                },
                {
                    "id": "t2",
                    "pair": "RELIANCE",
                    "signal_type": "LONG",
                    "entry": 1500,
                    "sl": 1480,
                    "tp1": 1520,
                    "created_at": "2026-06-29T00:00:00Z"
                },
                {
                    "id": "t3",
                    "pair": "GOLD",
                    "signal_type": "SHORT",
                    "entry": 4200,
                    "sl": 4230,
                    "tp1": 4160,
                    "created_at": "2026-06-30T00:00:00Z"
                },
                {
                    "id": "t4",
                    "pair": "EURUSD",
                    "signal_type": "LONG",
                    "entry": 1.10,
                    "sl": 1.095,
                    "tp1": 1.11,
                    "created_at": "2026-06-30T00:00:00Z"
                }
            ]
        }
        
        print(f"Sending POST /api/check-trades with {len(payload['trades'])} trades...")
        r = requests.post(f"{API}/check-trades", json=payload, timeout=60)
        print(f"Status: {r.status_code}")
        
        assert r.status_code == 200, f"Expected 200, got {r.status_code}"
        data = r.json()
        
        print(f"Response: {data}")
        
        # Verify response shape
        assert "checked" in data, "Missing 'checked' key"
        assert "resolved" in data, "Missing 'resolved' key"
        assert "results" in data, "Missing 'results' key"
        assert isinstance(data["results"], list), "results is not a list"
        
        # Verify checked count
        assert data["checked"] == 4, f"Expected checked=4, got {data['checked']}"
        
        print(f"\n✅ Checked: {data['checked']}")
        print(f"✅ Resolved: {data['resolved']}")
        
        # Verify each result has required fields
        for i, result in enumerate(data["results"]):
            print(f"\nTrade {i+1} ({result['id']}):")
            assert "id" in result, f"Missing 'id' in result {i}"
            assert "outcome" in result, f"Missing 'outcome' in result {i}"
            assert "close_price" in result, f"Missing 'close_price' in result {i}"
            assert "closed_at" in result, f"Missing 'closed_at' in result {i}"
            
            # Verify outcome is valid
            assert result["outcome"] in ["WIN", "LOSS", "OPEN"], f"Invalid outcome: {result['outcome']}"
            
            # Verify IDs match
            expected_ids = ["t1", "t2", "t3", "t4"]
            assert result["id"] in expected_ids, f"Unexpected ID: {result['id']}"
            
            print(f"  ID: {result['id']}")
            print(f"  Outcome: {result['outcome']}")
            print(f"  Close Price: {result['close_price']}")
            print(f"  Closed At: {result['closed_at']}")
        
        # Verify at least one trade is resolved (WIN or LOSS)
        resolved_count = sum(1 for r in data["results"] if r["outcome"] in ["WIN", "LOSS"])
        print(f"\n✅ Resolved trades: {resolved_count} out of 4")
        
        if resolved_count == 0:
            errors.append("WARNING: No trades resolved (expected at least 1 WIN or LOSS)")
            print("⚠️  WARNING: No trades resolved (expected at least 1)")
        else:
            print(f"✅ At least one trade resolved as expected")
        
        results["check_trades"].append({
            "test": "happy_path",
            "status": "PASS",
            "checked": data["checked"],
            "resolved": data["resolved"]
        })
        print("\n✅ PASS: Happy path test successful\n")
        return True
        
    except Exception as e:
        results["check_trades"].append({"test": "happy_path", "status": f"FAIL: {e}"})
        errors.append(f"Happy path test failed: {e}")
        print(f"❌ FAIL: {e}\n")
        return False


def test_check_trades_empty_batch():
    """Test 2: Empty batch"""
    print("=" * 60)
    print("TEST 2: Empty Batch")
    print("=" * 60)
    
    try:
        payload = {"trades": []}
        
        print(f"Sending POST /api/check-trades with empty trades list...")
        r = requests.post(f"{API}/check-trades", json=payload, timeout=30)
        print(f"Status: {r.status_code}")
        
        assert r.status_code == 200, f"Expected 200, got {r.status_code}"
        data = r.json()
        
        print(f"Response: {data}")
        
        # Verify response shape
        assert data["checked"] == 0, f"Expected checked=0, got {data['checked']}"
        assert data["resolved"] == 0, f"Expected resolved=0, got {data['resolved']}"
        assert data["results"] == [], f"Expected empty results, got {data['results']}"
        
        results["check_trades"].append({"test": "empty_batch", "status": "PASS"})
        print("\n✅ PASS: Empty batch test successful\n")
        return True
        
    except Exception as e:
        results["check_trades"].append({"test": "empty_batch", "status": f"FAIL: {e}"})
        errors.append(f"Empty batch test failed: {e}")
        print(f"❌ FAIL: {e}\n")
        return False


def test_check_trades_invalid_symbol():
    """Test 3: Invalid symbol"""
    print("=" * 60)
    print("TEST 3: Invalid Symbol")
    print("=" * 60)
    
    try:
        payload = {
            "trades": [
                {
                    "id": "tx",
                    "pair": "XXXNONE",
                    "signal_type": "LONG",
                    "entry": 100,
                    "sl": 90,
                    "tp1": 110,
                    "created_at": "2026-06-30T00:00:00Z"
                }
            ]
        }
        
        print(f"Sending POST /api/check-trades with invalid symbol XXXNONE...")
        r = requests.post(f"{API}/check-trades", json=payload, timeout=30)
        print(f"Status: {r.status_code}")
        
        assert r.status_code == 200, f"Expected 200, got {r.status_code}"
        data = r.json()
        
        print(f"Response: {data}")
        
        # Verify response shape
        assert data["checked"] == 1, f"Expected checked=1, got {data['checked']}"
        assert len(data["results"]) == 1, f"Expected 1 result, got {len(data['results'])}"
        
        result = data["results"][0]
        assert result["outcome"] == "OPEN", f"Expected outcome=OPEN, got {result['outcome']}"
        assert result["close_price"] is None, f"Expected close_price=None, got {result['close_price']}"
        
        results["check_trades"].append({"test": "invalid_symbol", "status": "PASS"})
        print("\n✅ PASS: Invalid symbol test successful (no crash)\n")
        return True
        
    except Exception as e:
        results["check_trades"].append({"test": "invalid_symbol", "status": f"FAIL: {e}"})
        errors.append(f"Invalid symbol test failed: {e}")
        print(f"❌ FAIL: {e}\n")
        return False


def test_check_trades_old_trade():
    """Test 4: Old trade (5m interval branch)"""
    print("=" * 60)
    print("TEST 4: Old Trade (5m interval branch)")
    print("=" * 60)
    
    try:
        # Create a trade from 10 days ago
        old_date = (datetime.utcnow() - timedelta(days=10)).strftime("%Y-%m-%dT%H:%M:%SZ")
        
        payload = {
            "trades": [
                {
                    "id": "old",
                    "pair": "NIFTY",
                    "signal_type": "LONG",
                    "entry": 22000,
                    "sl": 21500,
                    "tp1": 24000,
                    "created_at": old_date
                }
            ]
        }
        
        print(f"Sending POST /api/check-trades with trade from {old_date}...")
        r = requests.post(f"{API}/check-trades", json=payload, timeout=30)
        print(f"Status: {r.status_code}")
        
        assert r.status_code == 200, f"Expected 200, got {r.status_code}"
        data = r.json()
        
        print(f"Response: {data}")
        
        # Verify response shape
        assert data["checked"] == 1, f"Expected checked=1, got {data['checked']}"
        assert len(data["results"]) == 1, f"Expected 1 result, got {len(data['results'])}"
        
        result = data["results"][0]
        # Should either be WIN or OPEN, not crash
        assert result["outcome"] in ["WIN", "LOSS", "OPEN"], f"Invalid outcome: {result['outcome']}"
        
        print(f"\n✅ Outcome: {result['outcome']}")
        print(f"✅ Close Price: {result['close_price']}")
        
        results["check_trades"].append({"test": "old_trade", "status": "PASS", "outcome": result["outcome"]})
        print("\n✅ PASS: Old trade test successful (no crash)\n")
        return True
        
    except Exception as e:
        results["check_trades"].append({"test": "old_trade", "status": f"FAIL: {e}"})
        errors.append(f"Old trade test failed: {e}")
        print(f"❌ FAIL: {e}\n")
        return False


def test_check_trades_missing_created_at():
    """Test 5: Missing created_at"""
    print("=" * 60)
    print("TEST 5: Missing created_at")
    print("=" * 60)
    
    try:
        payload = {
            "trades": [
                {
                    "id": "no_date",
                    "pair": "RELIANCE",
                    "signal_type": "LONG",
                    "entry": 1500,
                    "sl": 1480,
                    "tp1": 1520
                    # No created_at field
                }
            ]
        }
        
        print(f"Sending POST /api/check-trades without created_at field...")
        r = requests.post(f"{API}/check-trades", json=payload, timeout=30)
        print(f"Status: {r.status_code}")
        
        assert r.status_code == 200, f"Expected 200, got {r.status_code}"
        data = r.json()
        
        print(f"Response: {data}")
        
        # Verify response shape
        assert data["checked"] == 1, f"Expected checked=1, got {data['checked']}"
        assert len(data["results"]) == 1, f"Expected 1 result, got {len(data['results'])}"
        
        result = data["results"][0]
        assert result["outcome"] in ["WIN", "LOSS", "OPEN"], f"Invalid outcome: {result['outcome']}"
        
        results["check_trades"].append({"test": "missing_created_at", "status": "PASS"})
        print("\n✅ PASS: Missing created_at test successful (no crash)\n")
        return True
        
    except Exception as e:
        results["check_trades"].append({"test": "missing_created_at", "status": f"FAIL: {e}"})
        errors.append(f"Missing created_at test failed: {e}")
        print(f"❌ FAIL: {e}\n")
        return False


def test_regression_endpoints():
    """Test 6: Regression — other endpoints still work"""
    print("=" * 60)
    print("TEST 6: Regression — Other Endpoints")
    print("=" * 60)
    
    all_passed = True
    
    # Test 6a: GET /api/health
    print("\n6a. Testing GET /api/health...")
    try:
        r = requests.get(f"{API}/health", timeout=10)
        print(f"Status: {r.status_code}")
        data = r.json()
        print(f"Response: {data}")
        
        assert r.status_code == 200, f"Expected 200, got {r.status_code}"
        assert data.get("python") == "ok", f"Python not ok: {data}"
        assert data.get("node_backend") == "ok", f"Node backend not ok: {data}"
        
        results["regression"].append({"endpoint": "/health", "status": "PASS"})
        print("✅ PASS")
    except Exception as e:
        all_passed = False
        results["regression"].append({"endpoint": "/health", "status": f"FAIL: {e}"})
        errors.append(f"Health endpoint failed: {e}")
        print(f"❌ FAIL: {e}")
    
    # Test 6b: GET /api/opportunities
    print("\n6b. Testing GET /api/opportunities?symbols=GOLD,BTCUSD&timeframes=1h&min_grade=B...")
    try:
        r = requests.get(
            f"{API}/opportunities",
            params={
                "symbols": "GOLD,BTCUSD",
                "timeframes": "1h",
                "min_grade": "B"
            },
            timeout=90
        )
        print(f"Status: {r.status_code}")
        data = r.json()
        
        assert r.status_code == 200, f"Expected 200, got {r.status_code}"
        assert "count" in data, "Missing 'count'"
        assert "opportunities" in data, "Missing 'opportunities'"
        
        print(f"Count: {data['count']}")
        results["regression"].append({"endpoint": "/opportunities", "status": "PASS", "count": data["count"]})
        print("✅ PASS")
    except Exception as e:
        all_passed = False
        results["regression"].append({"endpoint": "/opportunities", "status": f"FAIL: {e}"})
        errors.append(f"Opportunities endpoint failed: {e}")
        print(f"❌ FAIL: {e}")
    
    # Test 6c: POST /api/smc-analyze
    print("\n6c. Testing POST /api/smc-analyze (GOLD 1h)...")
    try:
        r = requests.post(
            f"{API}/smc-analyze",
            json={"pair": "GOLD", "timeframe": "1h"},
            timeout=30
        )
        print(f"Status: {r.status_code}")
        
        assert r.status_code == 200, f"Expected 200, got {r.status_code}"
        data = r.json()
        assert "liquidity_grab" in data, "Missing 'liquidity_grab'"
        
        results["regression"].append({"endpoint": "/smc-analyze", "status": "PASS"})
        print("✅ PASS")
    except Exception as e:
        all_passed = False
        results["regression"].append({"endpoint": "/smc-analyze", "status": f"FAIL: {e}"})
        errors.append(f"SMC analyze endpoint failed: {e}")
        print(f"❌ FAIL: {e}")
    
    # Test 6d: POST /api/chart-data
    print("\n6d. Testing POST /api/chart-data (RELIANCE 15m)...")
    try:
        r = requests.post(
            f"{API}/chart-data",
            json={"pair": "RELIANCE", "timeframe": "15m"},
            timeout=30
        )
        print(f"Status: {r.status_code}")
        
        assert r.status_code == 200, f"Expected 200, got {r.status_code}"
        data = r.json()
        assert "candles" in data, "Missing 'candles'"
        
        results["regression"].append({"endpoint": "/chart-data", "status": "PASS"})
        print("✅ PASS")
    except Exception as e:
        all_passed = False
        results["regression"].append({"endpoint": "/chart-data", "status": f"FAIL: {e}"})
        errors.append(f"Chart data endpoint failed: {e}")
        print(f"❌ FAIL: {e}")
    
    print(f"\n{'✅' if all_passed else '❌'} Regression: {'PASS' if all_passed else 'FAIL'}\n")
    return all_passed


def print_summary():
    """Print final summary"""
    print("\n" + "=" * 60)
    print("FINAL SUMMARY")
    print("=" * 60)
    
    print(f"\n📊 /api/check-trades Tests:")
    for item in results["check_trades"]:
        status_icon = "✅" if item["status"] == "PASS" else "❌"
        test_name = item["test"].replace("_", " ").title()
        print(f"   {status_icon} {test_name}: {item['status']}")
    
    print(f"\n📊 Regression Tests:")
    for item in results["regression"]:
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
    print("Starting /api/check-trades Backend Tests...\n")
    
    # Run all tests
    test1 = test_check_trades_happy_path()
    test2 = test_check_trades_empty_batch()
    test3 = test_check_trades_invalid_symbol()
    test4 = test_check_trades_old_trade()
    test5 = test_check_trades_missing_created_at()
    test6 = test_regression_endpoints()
    
    # Print summary
    print_summary()
    
    # Exit code
    all_pass = test1 and test2 and test3 and test4 and test5 and test6
    exit(0 if all_pass else 1)
