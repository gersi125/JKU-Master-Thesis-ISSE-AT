using System;
public class Person
{


    public int Age { get; set; }

    private void MethDec() {
        Console.WriteLine("Method Declaration");
    
    }


    public Person(string name, int age)
    {
        Name = name;
        Age = age;


    }
     

}


