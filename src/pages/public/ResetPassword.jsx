// ResetPassword.jsx
import { useState } from "react";
import { supabase } from "../../services/supabase";
import { useNavigate } from "react-router-dom";

function ResetPassword() {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [step, setStep] = useState("request"); // 'request', 'reset'
  const navigate = useNavigate();

  const handleRequestReset = async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) {
      setMessage(`Error: ${error.message}`);
    } else {
      setMessage("Password reset email sent. Enter the 6-digit code.");
      setStep("reset");
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    // Verify the OTP
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email,
      token: token,
      type: "recovery",
    });

    if (verifyError) {
      setMessage(`Error: ${verifyError.message}`);
      return;
    }

    // Update the password
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (updateError) {
      setMessage(`Error: ${updateError.message}`);
    } else {
      setMessage("Password updated successfully! Redirecting to login...");
      setTimeout(() => navigate("/login"), 3000);
    }
  };

  return (
    <div>
      {step === "request" && (
        <form onSubmit={handleRequestReset}>
          <input
            type="email"
            placeholder="Your Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <button type="submit">Send Reset Code</button>
        </form>
      )}

      {step === "reset" && (
        <form onSubmit={handleResetPassword}>
          <input
            type="email"
            placeholder="Your Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="text"
            placeholder="6-digit code from email"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="New Password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
          <button type="submit">Reset Password</button>
        </form>
      )}
      {message && <p>{message}</p>}
    </div>
  );
}

export default ResetPassword;