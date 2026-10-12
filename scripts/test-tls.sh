#!/usr/bin/env bash
set -euo pipefail

trust=1
if [ "${1:-}" = "--no-trust" ]; then
  trust=0
  shift
fi
dir="${1:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/fnox-test-tls}"
export MSYS_NO_PATHCONV=1

rm -rf "$dir"
mkdir -p "$dir"
cd "$dir"

cat > ca.cnf <<'CNF'
[req]
distinguished_name = dn
prompt = no
[dn]
CN = fnox-build test CA
[ca]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
CNF
cat > leaf.cnf <<'CNF'
[req]
distinguished_name = dn
prompt = no
[dn]
CN = localhost
[leaf]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = DNS:localhost,IP:127.0.0.1,IP:::1
authorityKeyIdentifier = keyid
CNF

openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 7 -config ca.cnf -extensions ca \
  -keyout ca.key -out ca.pem
openssl req -new -newkey rsa:2048 -nodes -sha256 -config leaf.cnf -keyout key.pem -out leaf.csr
openssl x509 -req -sha256 -days 7 -in leaf.csr -CA ca.pem -CAkey ca.key -set_serial "0x$(openssl rand -hex 8)" \
  -extfile leaf.cnf -extensions leaf -out cert.pem
rm -f ca.key leaf.csr ca.cnf leaf.cnf

if [ "$trust" = "1" ]; then
  case "$(uname -s)" in
    Darwin)
      sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ca.pem
      ;;
    Linux)
      sudo cp ca.pem /usr/local/share/ca-certificates/fnox-build-test.crt
      sudo update-ca-certificates
      sudo sysctl -w net.ipv4.ip_unprivileged_port_start=443
      ;;
    MINGW* | MSYS* | CYGWIN*)
      certutil -addstore -f Root ca.pem
      ;;
    *)
      echo "no way to trust a CA on $(uname -s)" >&2
      exit 2
      ;;
  esac
fi

if [ -n "${GITHUB_ENV:-}" ]; then
  echo "FNOX_TEST_TLS_DIR=$dir" >> "$GITHUB_ENV"
fi
echo "FNOX_TEST_TLS_DIR=$dir"
