# Stand-in for the Shiprocket API (same paths and response shapes as apiv2.shiprocket.in/v1/external) on :8795.
# Login: seller@test.in / secret123. Test controls: POST /_track {awb, status, activity, location} sets a parcel's
# tracking; GET /_calls lists what the app called.
import json, random
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

TOKEN = 'sr-test-token'
orders, tracks, calls = {}, {}, []
PICKUPS = [{'pickup_location': 'Home', 'pin_code': 411045, 'address': '4 Baner Road', 'city': 'Pune'},
           {'pickup_location': 'Shop', 'pin_code': 411001, 'address': '12 MG Road', 'city': 'Pune'}]
COURIERS = [
  {'courier_company_id': 10, 'courier_name': 'Delhivery Surface', 'rate': 72.0, 'estimated_delivery_days': '5', 'etd': 'Nov 9, 2026', 'rating': 4.2, 'cod': 1},
  {'courier_company_id': 20, 'courier_name': 'Xpressbees', 'rate': 65.5, 'estimated_delivery_days': '4', 'etd': 'Nov 8, 2026', 'rating': 4.0, 'cod': 1},
  {'courier_company_id': 30, 'courier_name': 'Blue Dart Air', 'rate': 140.0, 'estimated_delivery_days': '2', 'etd': 'Nov 6, 2026', 'rating': 4.6, 'cod': 0},
]

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _json(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def _auth(self): return self.headers.get('Authorization') == 'Bearer ' + TOKEN
    def _body(self):
        n = int(self.headers.get('Content-Length') or 0); raw = self.rfile.read(n) if n else b''
        try: return json.loads(raw or b'{}')
        except Exception: return {}
    def do_GET(self):
        u = urlparse(self.path); q = {k: v[0] for k, v in parse_qs(u.query).items()}; p = u.path.replace('/v1/external', '')
        calls.append(('GET', p))
        if p == '/_calls': return self._json(200, calls)
        if not self._auth(): return self._json(401, {'message': 'Token has expired', 'status_code': 401})
        if p == '/settings/company/pickup': return self._json(200, {'data': {'shipping_address': PICKUPS}})
        if p == '/open/postcode/details':
            m = {'560038': ('Bengaluru', 'Karnataka'), '110001': ('New Delhi', 'Delhi'), '700016': ('Kolkata', 'West Bengal')}
            c, s = m.get(q.get('postcode', ''), ('', ''))
            return self._json(200, {'postcode_details': {'city': c, 'state': s}})
        if p.rstrip('/') == '/courier/serviceability':
            if q.get('delivery_postcode') == '999999': return self._json(200, {'data': {'available_courier_companies': []}, 'status': 404})
            cod = q.get('cod') == '1'
            lst = [c for c in COURIERS if not cod or c['cod']]
            return self._json(200, {'data': {'available_courier_companies': lst, 'recommended_courier_company_id': 10}})
        if p.startswith('/courier/track/awb/'):
            awb = p.rsplit('/', 1)[1]; t = tracks.get(awb, {'status': 'AWB ASSIGNED', 'acts': []})
            return self._json(200, {'tracking_data': {'shipment_track': [{'current_status': t['status'], 'edd': '2026-11-08'}], 'shipment_track_activities': t['acts'], 'etd': '2026-11-08'}})
        return self._json(404, {'message': 'not found'})
    def do_POST(self):
        u = urlparse(self.path); p = u.path.replace('/v1/external', ''); b = self._body(); calls.append(('POST', p, b))
        if p == '/_track':
            t = tracks.setdefault(b['awb'], {'status': '', 'acts': []}); t['status'] = b['status']
            t['acts'].insert(0, {'date': b.get('date', '2026-11-05 10:00:00'), 'activity': b.get('activity', b['status']), 'location': b.get('location', 'Pune')})
            return self._json(200, {'ok': True})
        if p == '/auth/login':
            if b.get('email') == 'seller@test.in' and b.get('password') == 'secret123': return self._json(200, {'token': TOKEN})
            return self._json(400, {'message': 'Invalid email and password combination', 'status_code': 400})
        if not self._auth(): return self._json(401, {'message': 'Token has expired', 'status_code': 401})
        if p == '/orders/create/adhoc':
            for k in ['order_id', 'billing_customer_name', 'billing_address', 'billing_city', 'billing_pincode', 'billing_state', 'billing_phone', 'order_items', 'payment_method', 'sub_total', 'weight', 'pickup_location']:
                if b.get(k) in (None, '', []): return self._json(422, {'message': f'The {k} field is required.', 'status_code': 422})
            oid, sid = random.randint(10**8, 10**9), random.randint(10**8, 10**9)
            orders[sid] = {'order_id': oid, 'body': b, 'status': 'NEW'}
            return self._json(200, {'order_id': oid, 'shipment_id': sid, 'status': 'NEW', 'status_code': 1})
        if p == '/courier/assign/awb':
            sid = b.get('shipment_id'); c = next((x for x in COURIERS if x['courier_company_id'] == b.get('courier_id')), None)
            if sid not in orders or not c: return self._json(400, {'message': 'Courier not serviceable', 'status_code': 400})
            if orders[sid]['body']['payment_method'] == 'COD' and not c['cod']: return self._json(200, {'awb_assign_status': 0, 'message': 'COD not available with this courier'})
            awb = str(random.randint(10**11, 10**12)); orders[sid]['awb'] = awb; tracks[awb] = {'status': 'AWB ASSIGNED', 'acts': []}
            return self._json(200, {'awb_assign_status': 1, 'response': {'data': {'awb_code': awb, 'courier_name': c['courier_name'], 'freight_charges': c['rate']}}})
        if p == '/courier/generate/label': return self._json(200, {'label_created': 1, 'label_url': f'https://kr-shipmultichannel.s3.amazonaws.com/label-{b["shipment_id"][0]}.pdf'})
        if p == '/courier/generate/pickup':
            for s in b['shipment_id']:
                a = orders.get(int(s), {}).get('awb')
                if a: tracks[a]['status'] = 'PICKUP SCHEDULED'
            return self._json(200, {'pickup_status': 1, 'response': {'pickup_scheduled_date': '2026-11-04 10:00:00'}})
        if p == '/orders/cancel':
            for oid in b.get('ids', []):
                for o in orders.values():
                    if o['order_id'] == oid: o['status'] = 'CANCELED'
            return self._json(200, {'message': 'Order cancelled successfully'})
        if p.startswith('/ndr/') and p.endswith('/action'):
            awb = p.split('/')[2]
            if awb not in tracks: return self._json(404, {'message': 'AWB not found'})
            tracks[awb]['status'] = 'RTO INITIATED' if b.get('action') == 'return' else 'IN TRANSIT'
            return self._json(200, {'message': 'Action taken'})
        return self._json(404, {'message': 'not found'})

if __name__ == '__main__':
    HTTPServer(('127.0.0.1', 8795), H).serve_forever()
