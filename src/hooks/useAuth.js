import { useContext } from "react";
import AuthContext from "../contexts/authContextValue";

export default function useAuth() {
  return useContext(AuthContext);
}
