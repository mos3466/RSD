import importlib.util
import sys
import types
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent


class RfidBridgeProtocolTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Load the bridge with a small serial stub so these protocol tests do not
        # require pyserial or a physical Arduino.
        serial_stub = types.ModuleType("serial")
        serial_stub.SerialException = RuntimeError
        sys.modules.setdefault("serial", serial_stub)
        ports_stub = types.ModuleType("serial.tools.list_ports")
        ports_stub.comports = lambda: []
        tools_stub = types.ModuleType("serial.tools")
        tools_stub.list_ports = ports_stub
        sys.modules.setdefault("serial.tools", tools_stub)
        sys.modules.setdefault("serial.tools.list_ports", ports_stub)
        spec = importlib.util.spec_from_file_location("rfid_bridge_under_test", ROOT / "rfid_bridge.py")
        cls.bridge = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(cls.bridge)

    def test_backend_decisions_are_allow_listed(self):
        self.assertEqual(self.bridge.lcd_result_for_decision("TRIP_ACTIVE"), "TRIP_ACTIVE")
        self.assertEqual(self.bridge.lcd_result_for_decision("EXIT_ALLOWED"), "EXIT_ALLOWED")
        self.assertEqual(self.bridge.lcd_result_for_decision("HOLD"), "HOLD")
        self.assertEqual(self.bridge.lcd_result_for_decision("SCAN_ERROR"), "SCAN_ERROR")
        self.assertEqual(self.bridge.lcd_result_for_decision("unexpected"), "SCAN_ERROR")
        self.assertEqual(self.bridge.lcd_result_for_decision({}), "SCAN_ERROR")

    def test_serial_response_line_is_exact(self):
        class FakeDevice:
            def __init__(self):
                self.writes = []

            def write(self, value):
                self.writes.append(value)

            def flush(self):
                pass

        device = FakeDevice()
        self.bridge.send_lcd_result(device, "HOLD")
        self.assertEqual(device.writes, [b"RASD_RESULT=HOLD\n"])

    def test_auto_discovery_accepts_ch340_and_arduino_descriptions(self):
        class Port:
            def __init__(self, device, description, vid=None, pid=None):
                self.device = device
                self.description = description
                self.manufacturer = ""
                self.product = ""
                self.vid = vid
                self.pid = pid

        self.bridge.list_ports.comports = lambda: [Port("COM5", "USB-SERIAL CH340")]
        self.assertEqual(self.bridge.discover_port(""), "COM5")
        self.assertEqual(self.bridge.discover_port("COM9"), "COM9")

    def test_auto_discovery_waits_when_no_matching_device_exists(self):
        self.bridge.list_ports.comports = lambda: []
        self.assertIsNone(self.bridge.discover_port(""))


if __name__ == "__main__":
    unittest.main()
