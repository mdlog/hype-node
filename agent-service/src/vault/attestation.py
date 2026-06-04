"""EIP-712 PriceAttestation signer — matches HypeIndexVault's domain + typehash.
Contract: EIP712("HypeIndexVault","1"); PriceAttestation(bytes32 indexId,uint256 navPerShare,uint256 signedAt).
"""
from eth_account import Account
from eth_account.messages import encode_typed_data


def build_typed_data(chain_id: int, vault: str, index_id: str, nav: int, signed_at: int) -> dict:
    return {
        "types": {
            "EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
                {"name": "verifyingContract", "type": "address"},
            ],
            "PriceAttestation": [
                {"name": "indexId", "type": "bytes32"},
                {"name": "navPerShare", "type": "uint256"},
                {"name": "signedAt", "type": "uint256"},
            ],
        },
        "primaryType": "PriceAttestation",
        "domain": {"name": "HypeIndexVault", "version": "1", "chainId": chain_id, "verifyingContract": vault},
        "message": {"indexId": index_id, "navPerShare": nav, "signedAt": signed_at},
    }


def sign_attestation(signer_key: str, chain_id: int, vault: str, index_id: str, nav: int, signed_at: int) -> str:
    typed = build_typed_data(chain_id, vault, index_id, nav, signed_at)
    signed = Account.sign_message(encode_typed_data(full_message=typed), private_key=signer_key)
    sig = signed.signature
    return sig.to_0x_hex() if hasattr(sig, "to_0x_hex") else ("0x" + bytes(sig).hex())
