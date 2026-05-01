import { createContext } from "react";

const AuthContext = createContext({
  session: null,
  isChecking: true,
});

export default AuthContext;
