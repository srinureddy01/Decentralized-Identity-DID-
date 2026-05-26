import ConnectWallet  from "./components/ConnectWallet";
import RegisterDID    from "./components/RegisterDID";
import ProveIdentity  from "./components/ProveIdentity";
import Dashboard      from "./components/Dashboard";
import { useState }   from "react";

const CONTRACTS = {
  registry:    "0xDIDRegistryAddress",
  zkpVerifier: "0xZKPVerifierAddress",
  credNFT:     "0xCredentialNFTAddress",
};

export default function App() {
  const [wallet, setWallet] = useState(null);
  const [view,   setView]   = useState("dashboard");

  return (
    <>
      <ConnectWallet onConnect={setWallet} onDisconnect={() => setWallet(null)} />
      {wallet && view === "dashboard"  && (
        <Dashboard
          wallet={wallet}
          didRegistryAddress={CONTRACTS.registry}
          zkpVerifierAddress={CONTRACTS.zkpVerifier}
          credNFTAddress={CONTRACTS.credNFT}
          onGoRegister={() => setView("register")}
          onGoProve={() => setView("prove")}
        />
      )}
      {wallet && view === "register" && (
        <RegisterDID wallet={wallet} contractAddress={CONTRACTS.registry}
          onRegistered={() => setView("dashboard")} />
      )}
      {wallet && view === "prove" && (
        <ProveIdentity wallet={wallet} zkpVerifierAddress={CONTRACTS.zkpVerifier}
          credNFTAddress={CONTRACTS.credNFT} onProven={() => setView("dashboard")} />
      )}
    </>
  );
}
