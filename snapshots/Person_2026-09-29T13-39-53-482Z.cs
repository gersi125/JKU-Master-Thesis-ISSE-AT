using System;
using System.Security.Cryptography;

public class NewBaseType
{
    private string Address { get; set; }
    private string Name { get; set; }
    private string PhoneNumber { get; set; } 
    public Double Age { get; set; }
    private string Email { get; set; }

}

public class Teacher : NewBaseType
{
    public Teacher(string name,string phoneNumber,  string address,int age)
    {
    Name = name;
        if (age < 0)
        {   

            throw new ArgumentException("Age cannot be negative.");

        } else
        {
            
            
        }
        
        Address = address;
        PhoneNumber = phoneNumber;
        Email = email;
Age = age;
        Age = 12222;     
    }
     
}



