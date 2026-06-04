from eth_account import Account
from eth_account.messages import encode_typed_data
from src.vault.attestation import build_typed_data, sign_attestation

VAULT = "0x000000000000000000000000000000000000dEaD"
CHAIN = 31337
IDX = "0x" + "11" * 32

def test_sign_and_recover_roundtrip():
    acct = Account.create()
    sig = sign_attestation(acct.key.hex(), CHAIN, VAULT, IDX, nav=1_000_000, signed_at=1_700_000_000)
    assert isinstance(sig, str) and sig.startswith("0x") and len(sig) == 132  # 65 bytes
    typed = build_typed_data(CHAIN, VAULT, IDX, 1_000_000, 1_700_000_000)
    recovered = Account.recover_message(encode_typed_data(full_message=typed), signature=sig)
    assert recovered.lower() == acct.address.lower()

def test_domain_and_types_shape():
    typed = build_typed_data(CHAIN, VAULT, IDX, 1_000_000, 1_700_000_000)
    assert typed["domain"]["name"] == "HypeIndexVault"
    assert typed["domain"]["version"] == "1"
    assert typed["domain"]["chainId"] == CHAIN
    assert typed["domain"]["verifyingContract"].lower() == VAULT.lower()
    assert typed["primaryType"] == "PriceAttestation"
    names = [f["name"] for f in typed["types"]["PriceAttestation"]]
    assert names == ["indexId", "navPerShare", "signedAt"]
